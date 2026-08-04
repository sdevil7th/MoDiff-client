export type MediaKind = 'audio' | 'image' | 'text' | 'video';

export const POPULAR_MEDIA_IMPORT_EXTENSIONS: Record<Exclude<MediaKind, 'text'>, readonly string[]> = {
  audio: [
    '.wav',
    '.wave',
    '.bwf',
    '.aif',
    '.aiff',
    '.flac',
    '.mp3',
    '.m4a',
    '.aac',
    '.ogg',
    '.oga',
    '.opus',
    '.wma',
    '.mp4',
  ],
  image: ['.png', '.jpg', '.jpeg', '.webp', '.avif', '.gif', '.bmp', '.tif', '.tiff', '.ico'],
  video: ['.mp4', '.m4v', '.mov', '.webm', '.mkv', '.avi', '.mpeg', '.mpg', '.ts', '.mts', '.m2ts', '.wmv', '.flv'],
};

export function mediaAcceptString(kinds: Array<'audio' | 'image' | 'video'>) {
  return kinds
    .flatMap((kind) => [`${kind}/*`, ...POPULAR_MEDIA_IMPORT_EXTENSIONS[kind]])
    .filter((value, index, values) => values.indexOf(value) === index)
    .join(',');
}

export function inferImportedMediaKind(file: Pick<File, 'name' | 'type'>, allowed: Array<'audio' | 'image' | 'video'>) {
  const mimeKind = file.type.split('/', 1)[0] as 'audio' | 'image' | 'video' | undefined;
  if (mimeKind && allowed.includes(mimeKind)) return mimeKind;
  const lowerName = file.name.toLowerCase();
  const extensionMatches = allowed.filter((kind) =>
    POPULAR_MEDIA_IMPORT_EXTENSIONS[kind].some((extension) => lowerName.endsWith(extension)),
  );
  if (extensionMatches.length === 1) return extensionMatches[0] ?? null;
  if (extensionMatches.length > 1) return extensionMatches.includes('video') ? 'video' : (extensionMatches[0] ?? null);
  return null;
}
