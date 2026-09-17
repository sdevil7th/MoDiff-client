import { connectionTypesAreCompatible } from '../theme/connectionTypeCompatibility';

/**
 * Normalize only scalar value-type aliases admitted by the Block V2 contract.
 *
 * Modular Diffusers metadata uses Python spellings such as `builtins.str`,
 * while MoDiff runtime fields use names such as `text`. This compatibility is
 * used by Block V2 compilation/execution. Ordinary graph connectors also
 * normalize plain scalar spelling aliases; collections retain exact identities.
 *
 * Collection spellings are deliberately left intact: a declaration such as
 * `list[str]` carries shape information and must not be collapsed to `string`.
 */
export function normalizeBlockValueTypeV2(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(normalizeBlockValueTypeV2);
  if (typeof value !== 'string') return value;

  const normalized = value.trim().toLowerCase();
  // MiniMax H3's reference workflow deliberately carries the official,
  // ordered Diffusers reference dataclasses across the public Block V2
  // boundary. Keep that collection distinct from an untyped list or media
  // socket; order and the image/video/audio discriminant are semantic.
  if (normalized === 'list[diffusers.modular_pipelines.minimax_h3.references.minimaxh3reference]') {
    return 'minimax_h3_references';
  }
  const scalar = /^(?:builtins\.)?([a-z_][a-z\d_]*)$/u.exec(normalized)?.[1];
  if (!scalar) return value;

  const aliases: Readonly<Record<string, string>> = {
    opaque: 'any',
    str: 'string',
    string: 'string',
    text: 'string',
    bool: 'bool',
    boolean: 'bool',
    float: 'float',
    double: 'float',
    number: 'float',
    // Modular Diffusers uses this runtime type only for its string-valued
    // output_type enum (np/pil/pt). Preserve the options in node metadata while
    // exposing the connector/control as the value it actually carries.
    dropdown: 'string',
    int: 'int',
    integer: 'int',
  };
  return aliases[scalar] ?? value;
}

/** Compare two source/runtime declarations within the Block V2 boundary. */
export function blockValueTypesAreCompatibleV2(left: unknown, right: unknown) {
  const normalizedLeft = normalizeBlockValueTypeV2(left);
  const normalizedRight = normalizeBlockValueTypeV2(right);
  if (connectionTypesAreCompatible(normalizedLeft, normalizedRight)) return true;

  // A reviewed Block control can fan an integer value out to both an integer
  // generation field and a floating-point consumer such as a media export
  // frame rate. JavaScript/JSON has one finite number representation, and an
  // integer is losslessly accepted by the float destination. This is scoped
  // to the V2 compiler/editor boundary; it does not broaden ordinary canvas
  // connector compatibility or permit a float primary to drive an integer.
  const leftTypes = Array.isArray(normalizedLeft) ? normalizedLeft : [normalizedLeft];
  const rightTypes = Array.isArray(normalizedRight) ? normalizedRight : [normalizedRight];
  return leftTypes.some((value) => value === 'int') && rightTypes.some((value) => value === 'float');
}

/**
 * Validate a concrete Block V2 connector against the preview it feeds.
 *
 * Upstream Modular Diffusers manifests sometimes declare an image result as a
 * Python implementation union (PIL/numpy/tensor), while the finalized MoDiff
 * graph exposes `list[image]`. An exact stable-name boundary may use that
 * concrete runtime socket, but only when both declarations still describe the
 * media surface selected by the reviewed preview node.
 */
export function blockValueTypeMatchesMediaV2(value: unknown, mediaType: 'image' | 'video' | 'audio' | 'text' | 'file') {
  const values = Array.isArray(value) ? value : [value];
  const tokenPattern: Readonly<Record<typeof mediaType, RegExp>> = {
    image: /(?:^|[^a-z])(?:images?|pil|pixels?)(?:[^a-z]|$)/iu,
    video: /(?:^|[^a-z])(?:videos?|frames?)(?:[^a-z]|$)/iu,
    audio: /(?:^|[^a-z])(?:audios?|sounds?|waveforms?)(?:[^a-z]|$)/iu,
    text: /(?:^|[^a-z])(?:texts?|strings?|str)(?:[^a-z]|$)/iu,
    file: /(?:^|[^a-z])(?:files?|paths?|uris?|urls?)(?:[^a-z]|$)/iu,
  };
  return values.some((entry) => tokenPattern[mediaType].test(String(entry ?? '').trim()));
}

/** A declared media input may bind the matching file picker's string path. */
export function blockMediaFileBoundaryIsCompatibleV2(
  valueType: unknown,
  param: { display?: unknown; type?: unknown; fieldOptions?: unknown },
) {
  const options = param.fieldOptions;
  if (
    param.display !== 'filebrowser' ||
    !blockValueTypesAreCompatibleV2(param.type, 'string') ||
    !options ||
    typeof options !== 'object' ||
    Array.isArray(options) ||
    !('fileTypes' in options) ||
    !Array.isArray(options.fileTypes)
  )
    return false;
  const fileTypes = options.fileTypes;
  return (['image', 'video', 'audio'] as const).some(
    (mediaType) =>
      fileTypes.some(
        (fileType: unknown) => typeof fileType === 'string' && fileType.trim().toLowerCase() === mediaType,
      ) &&
      (blockValueTypeMatchesMediaV2(valueType, mediaType) ||
        // Official video loaders decode a video file into a sequence of PIL
        // frames. This exception requires an explicitly video-only-capable
        // picker; a single image never acquires video compatibility.
        (mediaType === 'video' &&
          (Array.isArray(valueType) ? valueType : [valueType]).some(
            (type) =>
              typeof type === 'string' &&
              /^(?:typing\.)?(?:list|sequence)\[(?:PIL\.Image\.Image|image)\]$/iu.test(type.trim()),
          ))),
  );
}
