import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { after, before, test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { gunzipSync } from 'node:zlib';
import { createServer } from 'vite';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const BACKEND_ROOT = path.resolve(ROOT, '..', 'MoDiff');
const PYTHON =
  process.env.MODIFF_BACKEND_PYTHON ||
  path.join(BACKEND_ROOT, '.venv', ...(process.platform === 'win32' ? ['Scripts', 'python.exe'] : ['bin', 'python']));
// CONTRIBUTING specifies direct managed Python on Windows; POSIX profiles use
// the existing environment wrapper before importing Torch.
const RUNTIME_LAUNCHER =
  process.platform === 'win32' ? PYTHON : path.join(BACKEND_ROOT, 'scripts', 'with-runtime-env.sh');

let adapter;
let blockSchema;
let seedRepair;
let derivedControlRepair;
let clusterInstance;
let clusterMaterializer;
let clusterRuntime;
let modelProfiles;
let modularConditionalModule;
let reviewedModularGraphModule;
let routeModule;
let server;
let snapshot;
let storage;

const backendSnapshotProgram = String.raw`
import json
import os
from copy import deepcopy
from importlib import import_module
from types import MethodType, SimpleNamespace
from unittest.mock import patch

# Catalog reproduction is a static contract audit. Its reviewed device defaults
# and option labels must not depend on the runner's hardware or optional packages.
# Keep the real schemas, capability builder, field actions and compiler below.
# This fixture does not qualify accelerator execution or install optional runtimes.
from utils import torch_utils

torch_utils.DEVICE_LIST = {
    "cuda:0": {"label": ["cuda:0"]},
    "cpu:0": {"label": ["cpu:0"]},
}
torch_utils.DEFAULT_DEVICE = "cuda:0"
torch_utils.CPU_DEVICE = "cpu:0"

from modiff import diffusers_profiles

runtime_target = diffusers_profiles.optional_runtime_target
diffusers_profiles.optional_runtime_target = lambda **kwargs: runtime_target(
    platform_name=kwargs.get("platform_name") or "linux",
    machine=kwargs.get("machine") or "x86_64",
)

from modiff.custom_extensions import ExtensionStore
# This is the built-in catalog. The child process has no pytest isolation and
# must not import, execute or disable the operator's installed custom sources.
with patch.object(ExtensionStore, "load_enabled", return_value=None):
    from modules import MODULE_MAP
assert not any(key.startswith("custom.") for key in MODULE_MAP)
from modiff.huggingface_cluster_promotions import build_post_promotion_node_library_candidate
from modiff.huggingface_node_library import build_huggingface_node_library
from modiff.modular_conditional_contracts import reviewed_modular_conditional_snapshot
from modiff.server import WebServer
from modiff.studio_execution_specs import _execution_spec_role_params, validate_studio_execution_specs

promotion_candidate_admission = os.environ.get("MODIFF_POST_PROMOTION_ADMISSION_ID", "")
library = (
    build_post_promotion_node_library_candidate(promotion_candidate_admission)
    if promotion_candidate_admission
    else build_huggingface_node_library()
)
specs = validate_studio_execution_specs(MODULE_MAP)
web = WebServer(modules=MODULE_MAP)
from modules.DiffusersRuntime.main import build_runtime_capabilities

web._available_runtime_devices = lambda: ["cuda:0", "cpu:0", "cpu"]
web._runtime_choice_capabilities_cache = build_runtime_capabilities(
    {"devices": [{"type": "cuda", "device": "cuda:0"}]},
    torch_module=SimpleNamespace(
        version=SimpleNamespace(hip="reviewed-contract", cuda=None),
        cuda=SimpleNamespace(is_bf16_supported=lambda: True),
        nn=SimpleNamespace(attention=object()),
    ),
    package_available=lambda _name: False,
)
registries = {}
base_registry = {}
for spec in specs:
    registry = {}
    for _role, node_key, _x, _y in spec["roles"]:
        module, action = node_key.rsplit(".", 1)
        node = MODULE_MAP[module][action]
        if node_key not in base_registry:
            base_registry[node_key] = {
                "module": module,
                "action": action,
                "type": node.get("type", "custom"),
                "label": node.get("label", action),
                "category": node.get("category", "default"),
                "description": node.get("description", ""),
                "resizable": node.get("resizable", False),
                "skipParamsCheck": node.get("skipParamsCheck", False),
                "style": node.get("style", ""),
                "params": web.describe_node_params(node.get("params", {})),
                "time": [0, 0, 0],
                "memory": [0, 0, 0],
                "cache": False,
            }
        registry[node_key] = {
            "module": module,
            "action": action,
            "type": node.get("type", "custom"),
            "label": node.get("label", action),
            "category": node.get("category", "default"),
            "description": node.get("description", ""),
            "resizable": node.get("resizable", False),
            "skipParamsCheck": node.get("skipParamsCheck", False),
            "style": node.get("style", ""),
            "params": web.describe_node_params(_execution_spec_role_params(spec, node_key, node)),
            "time": [0, 0, 0],
            "memory": [0, 0, 0],
            "cache": False,
        }
    registries[spec["id"]] = registry

# The exact Modular Diffusers compiler projects each upstream block placement
# through this reviewed executor. It is intentionally not a legacy Studio role,
# so include its authoritative schema alongside every role-scoped registry used
# by the browser audit.
reviewed_step_key = "modules.ModularDiffusers.ReviewedModularWorkflowStep"
reviewed_step_module, reviewed_step_action = reviewed_step_key.rsplit(".", 1)
reviewed_step_node = MODULE_MAP[reviewed_step_module][reviewed_step_action]
reviewed_step_registry = {
    "module": reviewed_step_module,
    "action": reviewed_step_action,
    "type": reviewed_step_node.get("type", "custom"),
    "label": reviewed_step_node.get("label", reviewed_step_action),
    "category": reviewed_step_node.get("category", "default"),
    "description": reviewed_step_node.get("description", ""),
    "resizable": reviewed_step_node.get("resizable", False),
    "skipParamsCheck": reviewed_step_node.get("skipParamsCheck", False),
    "style": reviewed_step_node.get("style", ""),
    "params": web.describe_node_params(reviewed_step_node.get("params", {})),
    "time": [0, 0, 0],
    "memory": [0, 0, 0],
    "cache": False,
}
base_registry[reviewed_step_key] = deepcopy(reviewed_step_registry)
for registry in registries.values():
    registry[reviewed_step_key] = deepcopy(reviewed_step_registry)


def _source_values(definition, admission):
    values = {
        field["name"]: deepcopy(field.get("default"))
        for field in definition.get("inputs", ())
        if isinstance(field, dict) and isinstance(field.get("name"), str)
    }
    values.update(deepcopy(admission.get("sealedBindingValues", {})))
    return values


def _browser_param_values(params):
    values = {}
    for field, param in params.items():
        if not isinstance(param, dict) or param.get("display") in {"input", "output"}:
            continue
        values[field] = deepcopy(param.get("value", param.get("default")))
    return values


def _bound_value(param, value):
    if isinstance(value, str) and (
        param.get("display") == "modelselect"
        or isinstance(param.get("value"), dict)
    ):
        return {"source": "hub", "value": value}
    return deepcopy(value)


def _capture_exec_publications(node, method_name, values, ref, signal_value, web):
    publications = []

    def publish_node_definition(_self, params):
        publications.append({
            "type": "node_definition",
            "params": web.describe_node_params(params),
        })

    def publish_visibility(_self, fields):
        publications.append({"type": "set_field_visibility", "fields": deepcopy(fields)})

    def publish_value(_self, fields):
        publications.append({"type": "set_field_value", "fields": deepcopy(fields)})

    def publish_params(_self, field, params):
        # set_field_params intentionally publishes raw params. In particular,
        # ModelsLoader's source-owned model type catalog must replace the
        # browser-described initial options exactly as the live websocket does.
        publications.append({
            "type": "set_field_params",
            "field": field,
            "params": deepcopy(params),
        })

    node.send_node_definition = MethodType(publish_node_definition, node)
    node.set_field_visibility = MethodType(publish_visibility, node)
    node.set_field_value = MethodType(publish_value, node)
    node.set_field_params = MethodType(publish_params, node)
    node.get_signal_value = MethodType(lambda _self, _field: deepcopy(signal_value), node)
    callback = getattr(node, method_name, None)
    if not callable(callback):
        raise ValueError(f"Declared registered field action {method_name!r} is not callable.")
    callback(deepcopy(values), deepcopy(ref))
    return publications


def _descriptor_steps(descriptor):
    if isinstance(descriptor, list):
        return descriptor
    return [descriptor]


def _route_finalization_witness(definition, admission, spec, registry, web):
    role_nodes = {role: node_key for role, node_key, _x, _y in spec["roles"]}
    source_values = _source_values(definition, admission)
    values_by_role = {}
    instances = {}
    for role, node_key in role_nodes.items():
        params = registry[node_key]["params"]
        values_by_role[role] = _browser_param_values(params)
        module, action = node_key.rsplit(".", 1)
        node_class = getattr(import_module(f"{module}.main"), action)
        instances[role] = node_class(node_id=f"registered-v2-audit:{role}")
    for role, field, source in spec["bindings"]:
        if source not in source_values:
            continue
        param = registry[role_nodes[role]]["params"].get(field)
        if isinstance(param, dict) and param.get("display") != "output":
            values_by_role[role][field] = _bound_value(param, source_values[source])

    actions = []
    for index, declared in enumerate(admission.get("dynamicFieldActions", ())):
        role = declared["role"]
        field = declared["field"]
        event = declared["event"]
        value_source = declared["valueSource"]
        if role not in role_nodes or value_source not in source_values:
            raise ValueError("Registered dynamic action has an unresolved role or source.")
        node_key = role_nodes[role]
        module, action = node_key.rsplit(".", 1)
        param = MODULE_MAP[module][action]["params"].get(field)
        descriptor = param.get(event) if isinstance(param, dict) else None
        if descriptor is None:
            raise ValueError("Registered dynamic action is absent from its authoritative node definition.")
        value = deepcopy(source_values[value_source])
        values = values_by_role[role]
        if event == "onChange":
            values[field] = deepcopy(value)

        publications = []
        applied_descriptors = []
        for step in _descriptor_steps(descriptor):
            if isinstance(step, str):
                publications.extend(
                    _capture_exec_publications(
                        instances[role],
                        step,
                        values,
                        {"node": f"registered-v2-audit:{role}", "key": field, "queue": False},
                        value,
                        web,
                    )
                )
                applied_descriptors.append({"action": "exec", "data": step})
                continue
            if not isinstance(step, dict) or step.get("action") not in {"exec", "value", "signal"}:
                raise ValueError("Registered dynamic action uses an unaudited client descriptor.")
            action_kind = step["action"]
            if action_kind == "exec":
                method_name = step.get("data")
                if not isinstance(method_name, str) or not method_name:
                    raise ValueError("Registered exec descriptor has no method name.")
                publications.extend(
                    _capture_exec_publications(
                        instances[role],
                        method_name,
                        values,
                        {"node": f"registered-v2-audit:{role}", "key": field, "queue": False},
                        value,
                        web,
                    )
                )
            elif action_kind == "value":
                target = step.get("target")
                if not isinstance(target, str) or not target:
                    raise ValueError("Registered value descriptor has no target field.")
                prop = step.get("prop", "value")
                if prop != "value":
                    # Non-value properties are replayed by the JS witness,
                    # while backend callbacks consume only ordinary values.
                    pass
                elif isinstance(step.get("data"), dict):
                    values[target] = deepcopy(step["data"].get(str(value)))
                else:
                    values[target] = deepcopy(value)
            applied_descriptors.append(deepcopy(step))

        actions.append({
            "index": index,
            **deepcopy(declared),
            "nodeKey": node_key,
            "value": value,
            "descriptor": deepcopy(descriptor),
            "appliedDescriptors": applied_descriptors,
            "publications": publications,
        })
    return {"schemaVersion": 1, "claim": "registered_dynamic_schema_witness", "actions": actions}


specs_by_id = {spec["id"]: spec for spec in specs}
finalization_witnesses = {}
for definition in library["definitions"]:
    for admission in definition.get("executionAdmissions", ()):
        if admission.get("status") != "admitted" or not admission.get("studioExecutionSpec"):
            continue
        spec = specs_by_id[admission["studioExecutionSpec"]["id"]]
        key = "\0".join((definition["id"], definition["contentHash"], admission["id"]))
        witness = _route_finalization_witness(
            definition,
            admission,
            spec,
            registries[spec["id"]],
            web,
        )
        repeated = _route_finalization_witness(
            definition,
            admission,
            spec,
            registries[spec["id"]],
            web,
        )
        if witness != repeated:
            raise ValueError("Registered dynamic schema witness is not deterministic.")
        finalization_witnesses[key] = witness

import base64, gzip
print(base64.b64encode(gzip.compress(json.dumps({
    "library": library,
    "specs": specs,
    "baseRegistry": base_registry,
    "registries": registries,
    "finalizationWitnesses": finalization_witnesses,
    "modularConditionalSnapshot": reviewed_modular_conditional_snapshot(),
}, allow_nan=False).encode(), mtime=0)).decode())
`;

function eligibleAdmission(admission) {
  return (
    admission.status === 'admitted' &&
    admission.claim === 'static_graph_contract_compatible' &&
    admission.executable === false &&
    admission.publication?.readiness === 'graph_qualified' &&
    admission.publication?.insertable === true &&
    admission.publication?.executable === false &&
    admission.reasons?.length === 0 &&
    admission.artifact &&
    admission.studioExecutionSpec &&
    admission.adapterContractId
  );
}

function compilerRouteKey(definition, admission) {
  return `${definition.id}\0${definition.contentHash}\0${admission.id}`;
}

function clusterBinding(param) {
  const value = param?.fieldOptions?.huggingFaceClusterBinding;
  return value?.schemaVersion === 1 ? value : null;
}

function lexical(left, right) {
  return left < right ? -1 : left > right ? 1 : 0;
}

function isPlainRecord(value) {
  return Boolean(value && typeof value === 'object' && !Array.isArray(value));
}

function clone(value) {
  return structuredClone(value);
}

function preserveBrowserParamState(current, incoming) {
  if (!current) return incoming;
  const preserved = { ...incoming };
  if (Object.prototype.hasOwnProperty.call(current, 'value')) preserved.value = current.value;
  if (current.signal !== undefined) preserved.signal = current.signal;
  if (current.isConnected !== undefined) preserved.isConnected = current.isConnected;
  const ownedFieldOptions = Object.fromEntries(
    Object.entries(current.fieldOptions ?? {}).filter(
      ([key]) => key === 'suppressInitialFieldAction' || key.startsWith('huggingFaceCluster'),
    ),
  );
  if (Object.keys(ownedFieldOptions).length) {
    preserved.fieldOptions = { ...(incoming.fieldOptions ?? {}), ...ownedFieldOptions };
  }
  return preserved;
}

function browserDefaultedParams(params) {
  return Object.fromEntries(
    Object.entries(clone(params)).map(([field, param]) => [field, { ...param, value: param.value ?? param.default }]),
  );
}

function applyLocalFieldActionDescriptor(node, descriptor, value, sourceField) {
  if (typeof descriptor === 'string') return;
  if (Array.isArray(descriptor)) {
    descriptor.forEach((step) => applyLocalFieldActionDescriptor(node, step, value, sourceField));
    return;
  }
  assert.ok(isPlainRecord(descriptor), 'registered dynamic action descriptor must be an object');
  const action = descriptor.action;
  if (action === 'exec') return;
  assert.ok(action === 'value' || action === 'signal', `unaudited registered client action ${String(action)}`);
  const target = descriptor.target;
  assert.equal(typeof target, 'string');
  // The generic descriptor is shared by several model contracts. The live
  // client treats a target omitted by the selected backend schema as a no-op.
  if (!node.data.params[target]) return;
  if (action === 'signal') {
    const direction = node.data.params[target].display;
    assert.ok(direction === 'input' || direction === 'output');
    node.data.params[target].signal = { direction, origin: sourceField, value: clone(value) };
    return;
  }
  const prop = descriptor.prop ?? 'value';
  assert.ok(['value', 'hidden', 'disabled', 'options', 'fieldOptions', 'display'].includes(prop));
  const mapped = isPlainRecord(descriptor.data) ? descriptor.data[String(value ?? '')] : (value ?? '');
  if (prop === 'fieldOptions' && isPlainRecord(mapped)) {
    node.data.params[target].fieldOptions = { ...(node.data.params[target].fieldOptions ?? {}), ...clone(mapped) };
  } else {
    node.data.params[target][prop] = clone(mapped);
  }
  if (prop === 'options') {
    const options = mapped;
    const valid = Array.isArray(options) ? options.map(String) : isPlainRecord(options) ? Object.keys(options) : [];
    const current = node.data.params[target].value;
    const multiple = Boolean(node.data.params[target].fieldOptions?.multiple);
    const selected = current ? (Array.isArray(current) ? current : [current]) : [];
    const retained = selected.filter((item) => valid.includes(String(item)));
    node.data.params[target].value = multiple ? retained : (retained[0] ?? '');
    node.data.params[target].disabled = false;
  }
}

function applyBackendPublication(node, nodeKey, publication, baseRegistry) {
  if (publication.type === 'node_definition') {
    const base = baseRegistry[nodeKey];
    assert.ok(base, `base registry definition ${nodeKey} is absent`);
    const incoming = browserDefaultedParams(publication.params);
    const next = { ...clone(base.params), ...incoming };
    Object.keys(next).forEach((field) => {
      next[field] = preserveBrowserParamState(node.data.params[field], next[field]);
    });
    node.data.params = next;
    return;
  }
  if (publication.type === 'set_field_visibility') {
    Object.entries(publication.fields).forEach(([field, visible]) => {
      assert.ok(node.data.params[field]);
      node.data.params[field].hidden = !visible;
    });
    return;
  }
  if (publication.type === 'set_field_value') {
    Object.entries(publication.fields).forEach(([field, value]) => {
      assert.ok(node.data.params[field]);
      node.data.params[field].value = clone(value);
    });
    return;
  }
  assert.equal(publication.type, 'set_field_params');
  const param = node.data.params[publication.field];
  assert.ok(param, `published field ${publication.field} is absent`);
  param.disabled = true;
  Object.entries(publication.params).forEach(([key, value]) => {
    const current = param[key];
    param[key] = isPlainRecord(current) && isPlainRecord(value) ? { ...current, ...clone(value) } : clone(value);
  });
  param.disabled = false;
}

function replayRegisteredFinalizationWitness(skeleton, witness, baseRegistry) {
  assert.equal(witness?.schemaVersion, 1);
  assert.equal(witness?.claim, 'registered_dynamic_schema_witness');
  const nodesByRole = new Map(skeleton.nodes.map((node) => [node.data.huggingFaceClusterExecutionRole, node]));
  witness.actions.forEach((action, index) => {
    assert.equal(action.index, index, 'registered actions must be witnessed in declared admission order');
    const node = nodesByRole.get(action.role);
    assert.ok(node, `witnessed role ${action.role} is absent`);
    const param = node.data.params[action.field];
    assert.ok(param, `witnessed field ${action.role}.${action.field} is absent`);
    if (action.event === 'onChange') param.value = clone(action.value);
    else {
      assert.equal(action.event, 'onSignal');
      const direction = param.display;
      assert.ok(direction === 'input' || direction === 'output');
      param.signal = { direction, value: clone(action.value) };
    }
    applyLocalFieldActionDescriptor(node, action.descriptor, action.value, action.field);
    action.publications.forEach((publication) =>
      applyBackendPublication(node, action.nodeKey, publication, baseRegistry),
    );
  });
  return skeleton;
}

function replayInitialHandleVisibility(skeleton) {
  const incoming = new Set(
    skeleton.edges
      .filter((edge) => typeof edge.targetHandle === 'string' && edge.targetHandle)
      .map((edge) => `${edge.target}\0${edge.targetHandle}`),
  );
  skeleton.nodes.forEach((node) => {
    Object.entries(node.data.params).forEach(([field, param]) => {
      if (param.display !== 'input' || !isPlainRecord(param.onChange) || param.onChange.action) return;
      const selected = incoming.has(`${node.id}\0${field}`) ? 'true' : 'false';
      const visibility = new Map();
      Object.entries(param.onChange).forEach(([key, fields]) => {
        (Array.isArray(fields) ? fields : [fields]).forEach((target) => {
          if (typeof target !== 'string') return;
          visibility.set(target, Boolean(visibility.get(target) || key === selected));
        });
      });
      visibility.forEach((visible, target) => {
        assert.ok(node.data.params[target], `initial visibility target ${target} is absent`);
        node.data.params[target].hidden = !visible;
      });
    });
  });
  return skeleton;
}

function normalizedDescriptorSteps(descriptor) {
  return (Array.isArray(descriptor) ? descriptor : [descriptor]).map((step) =>
    typeof step === 'string' ? { action: 'exec', data: step } : step,
  );
}

function finalizedRegisteredAuditSkeleton({ definition, instance, admission, executionSpec, skeleton, bindingValues }) {
  const key = compilerRouteKey(definition, admission);
  const witness = snapshot.finalizationWitnesses[key];
  assert.ok(witness, `dynamic finalization witness ${key} is absent`);
  assert.deepEqual(
    witness.actions.map(({ role, field, event, valueSource }) => ({ role, field, event, valueSource })),
    admission.dynamicFieldActions,
    'the witness must apply every admission-declared dynamic action exactly once and in order',
  );
  witness.actions.forEach((action) =>
    assert.deepEqual(
      action.appliedDescriptors,
      normalizedDescriptorSteps(action.descriptor),
      `${action.role}.${action.field} did not witness every declared client/exec action`,
    ),
  );
  let witnessed = replayRegisteredFinalizationWitness(skeleton, witness, snapshot.baseRegistry);
  // Qwen text-to-image is the first route whose reviewed pin includes the
  // ordinary HandleField mount-time visibility result. Reproduce that exact
  // browser step in this headless compiler witness; do not silently reseal
  // every other route until each receives the same live qualification.
  if (definition.id === 'diffusers.modular:QwenImageModularPipeline:text2image') {
    witnessed = replayInitialHandleVisibility(witnessed);
  }
  return {
    skeleton: clusterMaterializer.reconcileHuggingFaceClusterExecutionSkeleton({
      definition,
      instance,
      admission,
      executionSpec,
      skeleton: witnessed,
      currentNodes: witnessed.nodes,
      bindingValues,
      expanded: false,
    }),
    witness,
  };
}

const REVIEWED_MEDIA_FILE_INPUTS = new Map([
  [
    'diffusers.modular:WanAnimate2ModularPipeline:default\0driving_video',
    { role: 'loadPoseVideo', fieldId: 'file', mediaType: 'video' },
  ],
  [
    'diffusers.modular:WanAnimate2DistilledModularPipeline:default\0driving_video',
    { role: 'loadPoseVideo', fieldId: 'file', mediaType: 'video' },
  ],
  [
    'diffusers.modular:LTX2ModularPipeline:condition\0conditions',
    { role: 'loadImage', fieldId: 'file', mediaType: 'image' },
  ],
  [
    'diffusers.modular:LTX2ModularPipeline:in_context\0reference_conditions',
    { role: 'loadReferenceVideo', fieldId: 'file', mediaType: 'video' },
  ],
]);

function candidateFanOutContract(definition, admission, skeleton) {
  const fields = skeleton.nodes.flatMap((node) =>
    Object.entries(node.data.params).flatMap(([fieldId, param]) => {
      const binding = clusterBinding(param);
      return binding
        ? [
            {
              role: node.data.huggingFaceClusterExecutionRole,
              fieldId,
              param,
              binding,
            },
          ]
        : [];
    }),
  );
  const mutable = new Map();
  fields
    .filter(
      ({ binding, param }) =>
        (binding.persistence === 'instance_input' || binding.persistence === 'execution_parameter') &&
        param.display !== 'output',
    )
    .forEach((field) => {
      const key = `${field.binding.persistence}\0${field.binding.source}`;
      mutable.set(key, [...(mutable.get(key) ?? []), field]);
    });
  const controlFanOuts = [...mutable.entries()].flatMap(([key, group]) => {
    if (group.length < 2) return [];
    const [persistence, source] = key.split('\0');
    const fields = group
      .map(({ role, fieldId, param }) => ({ role, fieldId, param }))
      .sort((left, right) => lexical(`${left.role}\0${left.fieldId}`, `${right.role}\0${right.fieldId}`));
    // An integer frame-rate control may also drive the media exporter's float
    // input without loss. Keep the integer field as the public/control primary
    // so the reviewed fan-out never permits a fractional value to flow into an
    // integer generation field.
    const numericInteger = fields.find(({ param }) => /^(?:builtins\.)?(?:int|integer)$/iu.test(String(param.type)));
    const selectedPrimary = numericInteger ?? fields[0];
    const primary = { role: selectedPrimary.role, fieldId: selectedPrimary.fieldId };
    const mirrors = fields.filter((field) => field !== selectedPrimary).map(({ role, fieldId }) => ({ role, fieldId }));
    return [{ source, persistence, primary, mirrors }];
  });
  const fanOutBySource = new Map(controlFanOuts.map((fanOut) => [`${fanOut.persistence}\0${fanOut.source}`, fanOut]));
  const inputs = definition.inputs.flatMap((input) => {
    const admitted = admission.instanceInputBindings.find(({ input: inputName }) => inputName === input.name);
    if (!admitted) return [];
    const group = fields.filter(
      ({ binding }) => binding.persistence === 'instance_input' && binding.source === admitted.bindingSource,
    );
    const fanOut = fanOutBySource.get(`instance_input\0${admitted.bindingSource}`);
    const primaryTarget =
      fanOut?.primary ??
      group
        .map(({ role, fieldId }) => ({ role, fieldId }))
        .sort((left, right) => lexical(`${left.role}\0${left.fieldId}`, `${right.role}\0${right.fieldId}`))[0];
    const primary = group.find(
      ({ role, fieldId }) => role === primaryTarget?.role && fieldId === primaryTarget.fieldId,
    );
    if (!primaryTarget || !primary) return [];
    const sourceType = String(input.type ?? '');
    const mediaType = /audio|waveform|sound/iu.test(sourceType)
      ? 'audio'
      : /image|pil|pixel/iu.test(sourceType)
        ? 'image'
        : undefined;
    const reviewedMediaFile = REVIEWED_MEDIA_FILE_INPUTS.get(`${definition.id}\0${input.name}`);
    if (
      reviewedMediaFile &&
      (reviewedMediaFile.role !== primaryTarget.role || reviewedMediaFile.fieldId !== primaryTarget.fieldId)
    )
      throw new Error(`Reviewed media-file input ${definition.id}.${input.name} no longer targets its exact field.`);
    const collidesWithOutput = definition.outputs.some((output) => output.name === input.name);
    return [
      {
        portId: collidesWithOutput ? `${input.name}_input` : input.name,
        ...(collidesWithOutput ? { inputName: input.name } : {}),
        ...primaryTarget,
        ...(reviewedMediaFile && primary.param.display === 'filebrowser'
          ? { adaptation: 'media_file_path', mediaType: reviewedMediaFile.mediaType }
          : mediaType && primary.param.display === 'filebrowser'
            ? { adaptation: 'media_file_path', mediaType }
            : {}),
      },
    ];
  });
  return { controlFanOuts, inputs };
}

function outputMediaType(output) {
  const value = `${output.name} ${Array.isArray(output.type) ? output.type.join(' ') : output.type}`;
  if (/audio|sound|waveform/iu.test(value)) return 'audio';
  if (/video|frame/iu.test(value)) return 'video';
  if (/image|pil|pixel/iu.test(value)) return 'image';
  if (/text|string|str/iu.test(value)) return 'text';
  if (/file|path|uri|url/iu.test(value)) return 'file';
  return undefined;
}

function routeCandidateDiagnostic(definition, skeleton) {
  const nodesById = new Map(skeleton.nodes.map((node) => [node.id, node]));
  const previewNodeIds = new Set(
    skeleton.nodes
      .filter((node) =>
        Object.values(node.data.params).some((param) =>
          ['ui_image', 'ui_imagecompare', 'ui_video', 'ui_audio', 'ui_text', 'ui_file'].includes(param.display),
        ),
      )
      .map(({ id }) => id),
  );
  const consumed = new Set(skeleton.edges.map((edge) => `${edge.source}\0${edge.sourceHandle}`));
  const terminal = [];
  skeleton.edges.forEach((edge) => {
    if (!previewNodeIds.has(edge.target) || !edge.sourceHandle) return;
    const node = nodesById.get(edge.source);
    const param = node?.data.params[edge.sourceHandle];
    if (node && param)
      terminal.push({
        role: node.data.huggingFaceClusterExecutionRole,
        fieldId: edge.sourceHandle,
        type: param.type,
        display: param.display,
        reason: 'feeds_preview',
      });
  });
  skeleton.nodes.forEach((node) => {
    Object.entries(node.data.params).forEach(([fieldId, param]) => {
      if (param.display !== 'output' || consumed.has(`${node.id}\0${fieldId}`)) return;
      terminal.push({
        role: node.data.huggingFaceClusterExecutionRole,
        fieldId,
        type: param.type,
        display: param.display,
        reason: 'unconsumed_output',
      });
    });
  });
  const bound = skeleton.nodes.flatMap((node) =>
    Object.entries(node.data.params).flatMap(([fieldId, param]) => {
      const binding = clusterBinding(param);
      return binding
        ? [
            {
              role: node.data.huggingFaceClusterExecutionRole,
              fieldId,
              type: param.type,
              display: param.display,
              persistence: binding.persistence,
              source: binding.source,
            },
          ]
        : [];
    }),
  );
  return {
    missingBindingSources: skeleton.missingBindingSources,
    pendingFields: skeleton.pendingFields,
    definitionInputs: definition.inputs.map(({ name, type }) => ({ name, type })),
    definitionOutputs: definition.outputs.map(({ name, type }) => ({ name, type })),
    nodes: skeleton.nodes.map((node) => ({
      role: node.data.huggingFaceClusterExecutionRole,
      module: node.data.module,
      action: node.data.action,
      fields: Object.entries(node.data.params).map(([fieldId, param]) => ({
        fieldId,
        display: param.display,
        type: param.type,
      })),
    })),
    edges: skeleton.edges.map((edge) => ({
      sourceRole: nodesById.get(edge.source)?.data.huggingFaceClusterExecutionRole,
      sourceHandle: edge.sourceHandle,
      targetRole: nodesById.get(edge.target)?.data.huggingFaceClusterExecutionRole,
      targetHandle: edge.targetHandle,
    })),
    terminal,
    bound,
  };
}

const REVIEWED_VIDEO_FILE_DEFINITIONS = [
  'diffusers.modular:HeliosModularPipeline:text2video',
  'diffusers.modular:HeliosPyramidModularPipeline:text2video',
  'diffusers.modular:HeliosPyramidDistilledModularPipeline:text2video',
  'diffusers.modular:HunyuanVideo15ModularPipeline:image2video',
  'diffusers.modular:HunyuanVideo15ModularPipeline:text2video',
  'diffusers.modular:Cosmos3DistilledModularPipeline:image2video',
  'diffusers.modular:Cosmos3OmniModularPipeline:image2video',
  'diffusers.modular:Cosmos3OmniModularPipeline:video2video',
  'diffusers.modular:LTX2ModularPipeline:condition',
  'diffusers.modular:LTX2ModularPipeline:image2video',
  'diffusers.modular:LTX2ModularPipeline:in_context',
  'diffusers.modular:LTX2ModularPipeline:text2video',
  'diffusers.modular:LTXModularPipeline:image2video',
  'diffusers.modular:LTXModularPipeline:text2video',
  'diffusers.modular:Wan22Image2VideoModularPipeline:default',
  'diffusers.modular:Wan22ModularPipeline:default',
  'diffusers.modular:WanAnimate2DistilledModularPipeline:default',
  'diffusers.modular:WanAnimate2ModularPipeline:default',
  'diffusers.modular:WanImage2VideoModularPipeline:flf2v',
  'diffusers.modular:WanImage2VideoModularPipeline:image2video',
  'diffusers.modular:WanModularPipeline:default',
];

const REVIEWED_IMAGE_RESULT_DEFINITIONS = [
  'diffusers.modular:QwenImageEditModularPipeline:image_conditioned_inpainting',
  'diffusers.modular:QwenImageModularPipeline:controlnet_inpainting',
  'diffusers.modular:QwenImageModularPipeline:inpainting',
  'diffusers.modular:StableDiffusionXLModularPipeline:controlnet_inpainting',
  'diffusers.modular:StableDiffusionXLModularPipeline:controlnet_union_inpainting',
  'diffusers.modular:StableDiffusionXLModularPipeline:inpainting',
  'diffusers.modular:StableDiffusionXLModularPipeline:ip_adapter_controlnet_inpainting',
  'diffusers.modular:StableDiffusionXLModularPipeline:ip_adapter_controlnet_union_inpainting',
  'diffusers.modular:StableDiffusionXLModularPipeline:ip_adapter_inpainting',
];

/*
 * These are reviewed executable asset surfaces, not a heuristic request to
 * expose every upstream Modular state/intermediate. The exact definition,
 * admission and graph pins below still fail closed if any terminal changes.
 */
const REVIEWED_TERMINAL_OUTPUTS = new Map([
  ...[
    ['FluxControlNetPipeline', 'control_image', 'diffusersImageControl'],
    ['FluxControlNetImg2ImgPipeline', 'control_edit_image', 'diffusersImageControlEdit'],
    ['FluxControlNetInpaintPipeline', 'control_inpaint', 'diffusersImageControlInpaint'],
    ['Flux2KleinKVPipeline', 'text_to_image', 'diffusersImageGenerate'],
    ['Flux2KleinKVPipeline', 'edit_image', 'diffusersImageEdit'],
    ['Flux2KleinKVPipeline', 'multi_image_reference_edit', 'diffusersImageEdit'],
    ['Flux2KleinInpaintPipeline', 'inpaint', 'diffusersImageInpaint'],
    ['Flux2KleinInpaintPipeline', 'outpaint', 'diffusersImageInpaint'],
    ['Flux2KleinPipeline', 'multi_image_reference_edit', 'diffusersImageEdit'],
    ['Flux2Pipeline', 'multi_image_reference_edit', 'diffusersImageEdit'],
    ['FluxCannyPipeline', 'control_edit_image', 'diffusersImageControlEdit'],
    ['FluxCannyPipeline', 'control_image', 'diffusersImageControl'],
    ['FluxCannyPipeline', 'control_inpaint', 'diffusersImageControlInpaint'],
    ['FluxDepthPipeline', 'control_edit_image', 'diffusersImageControlEdit'],
    ['FluxDepthPipeline', 'control_image', 'diffusersImageControl'],
    ['FluxDepthPipeline', 'control_inpaint', 'diffusersImageControlInpaint'],
    ['FluxDevPipeline', 'inpaint', 'diffusersImageInpaint'],
    ['FluxFillPipeline', 'inpaint', 'diffusersImageInpaint'],
    ['FluxFillPipeline', 'outpaint', 'diffusersImageInpaint'],
    ['FluxKontextInpaintPipeline', 'inpaint', 'diffusersImageInpaint'],
    ['FluxKontextInpaintPipeline', 'outpaint', 'diffusersImageInpaint'],
    ['FluxKontextPipeline', 'multi_image_reference_edit', 'diffusersImageEdit'],
    ['FluxKreaPipeline', 'text_to_image', 'diffusersImageGenerate'],
    ['FluxReduxPipeline', 'edit_image', 'diffusersImageEdit'],
    ['FluxReduxPipeline', 'multi_image_reference_edit', 'diffusersImageEdit'],
    ['FluxSchnellPipeline', 'text_to_image', 'diffusersImageGenerate'],
  ].map(([pipeline, mode, role]) => [
    `diffusers.composite:${pipeline}:${mode}`,
    [{ portId: 'images', role, fieldId: 'images', adaptation: 'direct_media', mediaType: 'image' }],
  ]),
  ...REVIEWED_VIDEO_FILE_DEFINITIONS.map((definitionId) => [
    definitionId,
    [
      {
        portId: 'videos',
        role: 'videoExport',
        fieldId: 'file',
        adaptation: 'media_file_export',
        mediaType: 'video',
      },
    ],
  ]),
  ...REVIEWED_IMAGE_RESULT_DEFINITIONS.map((definitionId) => [
    definitionId,
    [{ portId: 'images', role: 'decode', fieldId: 'images', mediaType: 'image' }],
  ]),
  [
    'diffusers.modular:Cosmos3DistilledModularPipeline:text2image',
    [
      {
        portId: 'images',
        outputName: 'videos',
        role: 'decode',
        fieldId: 'image',
        mediaType: 'image',
      },
    ],
  ],
  [
    'diffusers.modular:Cosmos3OmniModularPipeline:text2image',
    [
      {
        portId: 'images',
        outputName: 'videos',
        role: 'decode',
        fieldId: 'image',
        mediaType: 'image',
      },
    ],
  ],
  [
    'diffusers.modular:Cosmos3OmniModularPipeline:text2video',
    [{ portId: 'videos', role: 'decode', fieldId: 'videos', mediaType: 'video' }],
  ],
  ...[
    'diffusers.modular:Cosmos3OmniModularPipeline:text2video_with_sound',
    'diffusers.modular:Cosmos3OmniModularPipeline:image2video_with_sound',
    'diffusers.modular:Cosmos3OmniModularPipeline:video2video_with_sound',
  ].map((definitionId) => [
    definitionId,
    [
      {
        portId: 'videos',
        role: 'videoExport',
        fieldId: 'file',
        adaptation: 'media_file_export',
        mediaType: 'video',
      },
    ],
  ]),
  [
    'diffusers.composite:WanTI2VPipeline:text_to_video',
    [
      {
        portId: 'video',
        role: 'videoExport',
        fieldId: 'file',
        adaptation: 'media_file_export',
        mediaType: 'video',
      },
    ],
  ],
  ...['text_to_audio', 'audio_variation', 'audio_continuation', 'audio_repaint'].map((mode) => [
    `diffusers.composite:AceStepAudioPipeline:${mode}`,
    [{ portId: 'audio', role: 'audioExport', fieldId: 'file', adaptation: 'media_file_export', mediaType: 'audio' }],
  ]),
  ...['LongCatAudioDiTPipeline', 'AudioLDM2Pipeline'].map((pipeline) => [
    `diffusers.composite:${pipeline}:text_to_audio`,
    [{ portId: 'audio', role: 'audioExport', fieldId: 'file', adaptation: 'media_file_export', mediaType: 'audio' }],
  ]),
  [
    'diffusers.modular:ErnieImageModularPipeline:text2image',
    [{ portId: 'images', role: 'decode', fieldId: 'images', adaptation: 'direct_media', mediaType: 'image' }],
  ],
]);

before(async () => {
  storage = new Map();
  globalThis.localStorage = {
    clear: () => storage.clear(),
    getItem: (key) => storage.get(key) ?? null,
    key: (index) => [...storage.keys()][index] ?? null,
    get length() {
      return storage.size;
    },
    removeItem: (key) => storage.delete(key),
    setItem: (key, value) => storage.set(key, String(value)),
  };
  globalThis.window = {
    dispatchEvent: () => true,
    location: { origin: 'http://127.0.0.1:5191' },
    localStorage: globalThis.localStorage,
  };
  if (!existsSync(PYTHON)) throw new Error(`MoDiff backend Python is missing: ${PYTHON}`);
  if (!existsSync(RUNTIME_LAUNCHER)) throw new Error(`MoDiff runtime launcher is missing: ${RUNTIME_LAUNCHER}`);
  const result = spawnSync(
    RUNTIME_LAUNCHER,
    [...(process.platform === 'win32' ? [] : [PYTHON]), '-c', backendSnapshotProgram],
    {
      cwd: BACKEND_ROOT,
      encoding: 'utf8',
      env: { ...process.env, PYTHONPATH: BACKEND_ROOT },
      maxBuffer: 32 * 1024 * 1024,
    },
  );
  if (result.status !== 0)
    throw new Error(
      `Could not build the live backend route audit (${result.error?.message ?? result.signal ?? result.status}; ${result.stdout?.length ?? 0} bytes):\n${result.stderr}`,
    );
  snapshot = JSON.parse(gunzipSync(Buffer.from(result.stdout.trim(), 'base64')).toString('utf8'));
  server = await createServer({
    root: ROOT,
    configFile: false,
    logLevel: 'silent',
    optimizeDeps: { entries: [], noDiscovery: true },
    server: { middlewareMode: true, watch: null },
    appType: 'custom',
  });
  adapter = await server.ssrLoadModule('/src/studio/registeredBlockAdapterV2.ts');
  blockSchema = await server.ssrLoadModule('/src/studio/blockSchemaV2.ts');
  seedRepair = await server.ssrLoadModule('/src/studio/blockSeedRepairV2.ts');
  derivedControlRepair = await server.ssrLoadModule('/src/studio/blockDerivedControlRepairV2.ts');
  clusterInstance = await server.ssrLoadModule('/src/studio/huggingFaceClusterInstance.ts');
  clusterMaterializer = await server.ssrLoadModule('/src/studio/huggingFaceClusterMaterializer.ts');
  clusterRuntime = await server.ssrLoadModule('/src/studio/huggingFaceClusterRuntime.ts');
  modelProfiles = await server.ssrLoadModule('/src/studio/modelProfiles.ts');
  modularConditionalModule = await server.ssrLoadModule('/src/studio/huggingFaceModularConditionals.ts');
  reviewedModularGraphModule = await server.ssrLoadModule('/src/studio/reviewedModularGraphV2.ts');
  routeModule = await server.ssrLoadModule('/src/studio/registeredBlockV2Routes.ts');
});

after(async () => {
  await server?.close();
  delete globalThis.window;
  delete globalThis.localStorage;
});

test('every explicitly routed admission is an exact backend schema-v6 compiler success with fixed runtime probes', () => {
  const specs = new Map(snapshot.specs.map((spec) => [spec.id, spec]));
  const eligibleAdmissions = snapshot.library.definitions.flatMap((definition) =>
    definition.executionAdmissions.filter(eligibleAdmission).map((admission) => ({ definition, admission })),
  );
  const expectedAdmissionCount = eligibleAdmissions.length;
  const expectedDiffusersCount = eligibleAdmissions.filter(
    ({ definition }) => definition.provider === 'diffusers',
  ).length;
  const expectedTransformersCount = eligibleAdmissions.filter(
    ({ definition }) => definition.provider === 'transformers',
  ).length;
  const compilerSuccesses = new Map();
  const failures = [];
  const routeCandidates = [];
  for (const definition of snapshot.library.definitions) {
    for (const admission of definition.executionAdmissions.filter(eligibleAdmission)) {
      try {
        const executionSpec = specs.get(admission.studioExecutionSpec.id);
        assert.ok(executionSpec, 'the exact Studio execution specification is absent');
        assert.deepEqual(
          {
            id: executionSpec.id,
            contentHash: executionSpec.contentHash,
            executionProfileId: executionSpec.executionProfileId,
          },
          admission.studioExecutionSpec,
        );
        const parameterOverrides = Object.fromEntries(definition.inputs.map((field) => [field.name, field.default]));
        let instance = clusterInstance.createHuggingFaceClusterInstance(
          definition,
          `route-audit:${definition.provider}:${compilerSuccesses.size}`,
          parameterOverrides,
        );
        instance = clusterInstance.setHuggingFaceClusterExecution(instance, definition, admission.id);
        const form = modelProfiles.getFormDefaultsForRegisteredRoute(admission.studioMode, definition.pipelineClass);
        const bindingValues = clusterRuntime.huggingFaceClusterExecutionParameterValues(admission, form);
        const materialized = clusterMaterializer.materializeHuggingFaceClusterExecutionSkeleton({
          definition,
          instance,
          admission,
          executionSpec,
          nodesRegistry: snapshot.registries[executionSpec.id],
          bindingValues,
          expanded: false,
        });
        const { skeleton, witness } = finalizedRegisteredAuditSkeleton({
          definition,
          instance,
          admission,
          executionSpec,
          skeleton: materialized,
          bindingValues,
        });
        assert.equal(skeleton.bindingsComplete, true);
        const registeredRoute = routeModule.registeredBlockV2Route(definition, admission);
        const previousRoute = routeModule.REGISTERED_BLOCK_V2_ROUTES.find(
          (candidate) => candidate.definitionId === definition.id && candidate.admissionId === admission.id,
        );
        const route =
          process.env.MODIFF_GENERATE_ROUTE_CANDIDATES === '1' && previousRoute
            ? {
                ...previousRoute,
                definitionContentHash: definition.contentHash,
                provider: definition.provider,
                surface: definition.surface,
                definitionKind: definition.definitionKind,
                libraryRevision: definition.libraryRevision,
                pipelineClass: definition.pipelineClass,
                workflowId: definition.workflowId,
                studioMode: admission.studioMode,
                adapterContractId: admission.adapterContractId,
                studioExecutionSpec: structuredClone(admission.studioExecutionSpec),
                artifact: structuredClone(admission.artifact),
                dynamicFieldActions: structuredClone(admission.dynamicFieldActions),
              }
            : registeredRoute;
        if (
          process.env.MODIFF_DEBUG_EXACT_DEFINITION &&
          definition.id.includes(process.env.MODIFF_DEBUG_EXACT_DEFINITION) &&
          route &&
          definition.provider === 'diffusers' &&
          definition.definitionKind === 'modular_pipeline_workflow' &&
          definition.integrationStatus !== 'equivalent_standard_route'
        ) {
          const debugProjection = reviewedModularGraphModule.reviewedModularGraphV2(
            definition,
            skeleton,
            route,
            snapshot.library.blockDefinitions,
            snapshot.registries[executionSpec.id]['modules.ModularDiffusers.ReviewedModularWorkflowStep'],
            modularConditionalModule.parseHuggingFaceModularConditionalSnapshot(snapshot.modularConditionalSnapshot),
            snapshot.library.blockRoleAdapters,
          );
          process.stderr.write(`${JSON.stringify(routeCandidateDiagnostic(definition, debugProjection.skeleton))}\n`);
        }
        const compiled = adapter.compileRegisteredBlockV2(definition, skeleton, {
          instanceId: instance.instanceId,
          position: { x: 0, y: 0 },
          ...(route ? { route } : {}),
          blockDefinitions: snapshot.library.blockDefinitions,
          blockRoleAdapters: snapshot.library.blockRoleAdapters,
          reviewedModularStepNodeData:
            snapshot.registries[executionSpec.id]['modules.ModularDiffusers.ReviewedModularWorkflowStep'],
          modularConditionalSnapshot: modularConditionalModule.parseHuggingFaceModularConditionalSnapshot(
            snapshot.modularConditionalSnapshot,
          ),
        });
        const incomingSockets = new Set(
          compiled.definition.graph.edges.map((edge) => `${edge.targetNodeId}\0${edge.targetPortId}`),
        );
        assert.deepEqual(
          seedRepair.inspectBlockSeedBindingsV2(compiled.instance, snapshot.library.blockDefinitions),
          [],
          `${admission.id}: new admissions must not need a seed repair`,
        );
        const compiledNodesById = new Map(compiled.definition.graph.nodes.map((node) => [node.nodeId, node]));
        assert.deepEqual(
          derivedControlRepair.inspectBlockDerivedControlsV2(compiled.instance, snapshot.library.blockDefinitions),
          [],
          `${definition.id} contains duplicate caller bindings after a state writer`,
        );
        const seedConsumers = compiled.definition.graph.nodes.filter(
          (node) => node.data.action === 'ReviewedModularWorkflowStep' && node.data.params?.seed,
        );
        for (const node of seedConsumers) {
          const block = snapshot.library.blockDefinitions.find(
            (block) => block.id === node.modularDiffusers?.blockDefinitionId,
          );
          assert.ok(
            block?.inputs.some(({ name }) => name === 'generator'),
            `${admission.id}: seed on ${node.nodeId} is not consumed by upstream Generator input`,
          );
        }
        assert.ok(
          seedConsumers.length <= 1,
          `${admission.id}: shared Generator must not be reset at every mirrored leaf`,
        );
        for (const edge of compiled.definition.graph.edges) {
          const sourceField = compiledNodesById.get(edge.sourceNodeId)?.data.params?.[edge.sourcePortId];
          const targetField = compiledNodesById.get(edge.targetNodeId)?.data.params?.[edge.targetPortId];
          assert.equal(
            sourceField?.display,
            'output',
            `${admission.id}: missing output ${edge.sourceNodeId}.${edge.sourcePortId}`,
          );
          assert.ok(
            targetField && targetField.display !== 'output',
            `${admission.id}: missing input ${edge.targetNodeId}.${edge.targetPortId}`,
          );
        }
        const unboundRequiredInputs = compiled.definition.graph.nodes.flatMap((node) =>
          Object.entries(node.data.params ?? {}).flatMap(([fieldId, param]) =>
            param?.display === 'input' && param.required === true && !incomingSockets.has(`${node.nodeId}\0${fieldId}`)
              ? [`${node.nodeId}.${fieldId}`]
              : [],
          ),
        );
        assert.deepEqual(
          unboundRequiredInputs,
          [],
          `the exact graph leaves required runtime sockets unbound: ${unboundRequiredInputs.join(', ')}`,
        );
        assert.equal(compiled.definition.source.executionAdmissionId, admission.id);
        if (route && process.env.MODIFF_GENERATE_ROUTE_CANDIDATES !== '1') {
          assert.equal(compiled.definition.contentHash, route.compiledDefinitionContentHash);
          assert.equal(
            `sha256:${createHash('sha256')
              .update(
                blockSchema.canonicalBlockStringifyV2(blockSchema.canonicalBlockDefinitionV2(compiled.definition)),
              )
              .digest('hex')}`,
            route.compiledDefinitionCanonicalSha256,
          );
          const tamperedBoundary = structuredClone(route);
          tamperedBoundary.boundary.outputs[0].fieldId = 'unreviewed_output';
          assert.throws(
            () =>
              adapter.compileRegisteredBlockV2(definition, skeleton, {
                instanceId: `${instance.instanceId}:tampered`,
                position: { x: 0, y: 0 },
                route: tamperedBoundary,
                blockDefinitions: snapshot.library.blockDefinitions,
                blockRoleAdapters: snapshot.library.blockRoleAdapters,
                reviewedModularStepNodeData:
                  snapshot.registries[executionSpec.id]['modules.ModularDiffusers.ReviewedModularWorkflowStep'],
              }),
            /reviewed registered output projection/u,
          );
        }
        compilerSuccesses.set(compilerRouteKey(definition, admission), {
          definition,
          admission,
          skeleton,
          witness,
          compiledDefinition: compiled.definition,
          compiledInstance: compiled.instance,
          blockDefinitionContentHash: compiled.definition.contentHash,
          blockDefinitionCanonicalSha256: `sha256:${createHash('sha256')
            .update(blockSchema.canonicalBlockStringifyV2(blockSchema.canonicalBlockDefinitionV2(compiled.definition)))
            .digest('hex')}`,
          routeCandidate: route,
        });
      } catch (error) {
        failures.push({ definitionId: definition.id, admissionId: admission.id, message: String(error) });
        if (process.env.MODIFF_GENERATE_ROUTE_CANDIDATES === '1') {
          let candidateSkeleton;
          try {
            const executionSpec = specs.get(admission.studioExecutionSpec.id);
            const parameterOverrides = Object.fromEntries(
              definition.inputs.map((field) => [field.name, field.default]),
            );
            let instance = clusterInstance.createHuggingFaceClusterInstance(
              definition,
              `route-candidate:${definition.provider}:${routeCandidates.length}`,
              parameterOverrides,
            );
            instance = clusterInstance.setHuggingFaceClusterExecution(instance, definition, admission.id);
            const form = modelProfiles.getFormDefaultsForRegisteredRoute(
              admission.studioMode,
              definition.pipelineClass,
            );
            const bindingValues = clusterRuntime.huggingFaceClusterExecutionParameterValues(admission, form);
            const materialized = clusterMaterializer.materializeHuggingFaceClusterExecutionSkeleton({
              definition,
              instance,
              admission,
              executionSpec,
              nodesRegistry: snapshot.registries[executionSpec.id],
              bindingValues,
              expanded: false,
            });
            const { skeleton } = finalizedRegisteredAuditSkeleton({
              definition,
              instance,
              admission,
              executionSpec,
              skeleton: materialized,
              bindingValues,
            });
            candidateSkeleton = skeleton;
            const { controlFanOuts, inputs } = candidateFanOutContract(definition, admission, skeleton);
            const reviewedTerminalOutputs = REVIEWED_TERMINAL_OUTPUTS.get(definition.id);
            const outputs = reviewedTerminalOutputs
              ? structuredClone(reviewedTerminalOutputs)
              : (() => {
                  const discoveryRoute = { boundary: { inputs }, controlFanOuts };
                  const discovery = adapter.compileRegisteredBlockV2(definition, skeleton, {
                    instanceId: `candidate:${instance.instanceId}`,
                    route: discoveryRoute,
                    blockDefinitions: snapshot.library.blockDefinitions,
                    blockRoleAdapters: snapshot.library.blockRoleAdapters,
                    reviewedModularStepNodeData:
                      snapshot.registries[executionSpec.id]['modules.ModularDiffusers.ReviewedModularWorkflowStep'],
                  });
                  assert.ok(
                    discovery.definition.boundary.outputs.length > 0,
                    'no exact public asset output was discovered',
                  );
                  return discovery.definition.boundary.outputs.map((port) => {
                    const sourceOutput = definition.outputs.find(({ name }) => name === port.portId);
                    const mediaType = outputMediaType(sourceOutput);
                    return {
                      portId: port.portId,
                      role: port.binding.nodeId,
                      fieldId: port.binding.fieldOrPortId,
                      ...(mediaType ? { mediaType } : {}),
                    };
                  });
                })();
            const exactRoute = {
              definitionId: definition.id,
              definitionContentHash: definition.contentHash,
              provider: definition.provider,
              surface: definition.surface,
              definitionKind: definition.definitionKind,
              libraryRevision: definition.libraryRevision,
              pipelineClass: definition.pipelineClass,
              workflowId: definition.workflowId,
              admissionId: admission.id,
              studioMode: admission.studioMode,
              adapterContractId: admission.adapterContractId,
              studioExecutionSpec: structuredClone(admission.studioExecutionSpec),
              artifact: admission.artifact,
              dynamicFieldActions: admission.dynamicFieldActions,
              boundary: { inputs, outputs },
              controlFanOuts,
              ...(definition.provider === 'diffusers' &&
              definition.definitionKind === 'modular_pipeline_workflow' &&
              definition.blocksClass !== null &&
              definition.integrationStatus !== 'equivalent_standard_route'
                ? { exactModularGraph: { semanticRoleByPlacementPath: {} } }
                : {}),
            };
            const exact = adapter.compileRegisteredBlockV2(definition, skeleton, {
              instanceId: `candidate-exact:${instance.instanceId}`,
              route: exactRoute,
              blockDefinitions: snapshot.library.blockDefinitions,
              blockRoleAdapters: snapshot.library.blockRoleAdapters,
              reviewedModularStepNodeData:
                snapshot.registries[executionSpec.id]['modules.ModularDiffusers.ReviewedModularWorkflowStep'],
            });
            routeCandidates.push({
              ...exactRoute,
              compiledDefinitionContentHash: exact.definition.contentHash,
              compiledDefinitionCanonicalSha256: `sha256:${createHash('sha256')
                .update(blockSchema.canonicalBlockStringifyV2(blockSchema.canonicalBlockDefinitionV2(exact.definition)))
                .digest('hex')}`,
            });
          } catch (candidateError) {
            routeCandidates.push({
              definitionId: definition.id,
              admissionId: admission.id,
              originalError: String(error),
              candidateError: String(candidateError),
              ...(process.env.MODIFF_ROUTE_CANDIDATES_FULL === '1' && candidateSkeleton
                ? { diagnostic: routeCandidateDiagnostic(definition, candidateSkeleton) }
                : {}),
            });
          }
        }
      }
    }
  }

  const routed = routeModule.REGISTERED_BLOCK_V2_ROUTES.map((route) => {
    if (process.env.MODIFF_GENERATE_ROUTE_CANDIDATES === '1') {
      const currentKey = [...compilerSuccesses.keys()].find(
        (key) => key.startsWith(`${route.definitionId}\0`) && key.endsWith(`\0${route.admissionId}`),
      );
      if (currentKey) return currentKey;
    }
    return `${route.definitionId}\0${route.definitionContentHash}\0${route.admissionId}`;
  });
  assert.equal(new Set(routed).size, routed.length, 'registered Block V2 route identities must be unique');
  const staleRoutes = routed.filter((key) => !compilerSuccesses.has(key));
  if (process.env.MODIFF_AUDIT_DISCOVERY !== '1') {
    const staleRouteFailures = failures.filter(({ definitionId, admissionId }) =>
      staleRoutes.some((key) => key.startsWith(`${definitionId}\0`) && key.endsWith(`\0${admissionId}`)),
    );
    assert.deepEqual(
      staleRoutes,
      [],
      `route data contains an admission that did not compile:\n${JSON.stringify(staleRouteFailures, null, 2)}`,
    );
  }

  const unroutedSuccesses = [...compilerSuccesses.keys()].filter((key) => !routed.includes(key));
  if (process.env.MODIFF_AUDIT_DISCOVERY !== '1') {
    assert.deepEqual(
      unroutedSuccesses,
      [],
      `live compiler successes are not explicitly routed:\n${unroutedSuccesses.join('\n')}`,
    );
  }
  assert.equal(failures.length + compilerSuccesses.size, expectedAdmissionCount);
  if (process.env.MODIFF_ROUTE_CANDIDATES_ONLY !== '1') {
    assert.equal(
      compilerSuccesses.size,
      process.env.MODIFF_GENERATE_ROUTE_CANDIDATES === '1'
        ? routeModule.REGISTERED_BLOCK_V2_ROUTES.length
        : expectedAdmissionCount,
    );
  }
  if (process.env.MODIFF_AUDIT_DISCOVERY === '1' && process.env.MODIFF_ROUTE_CANDIDATES_ONLY !== '1') {
    process.stdout.write(
      `${JSON.stringify(
        Object.fromEntries(
          [...compilerSuccesses.values()]
            .map(({ admission, blockDefinitionContentHash }) => [admission.id, blockDefinitionContentHash])
            .sort(([left], [right]) => left.localeCompare(right)),
        ),
        null,
        2,
      )}\n`,
    );
  }
  if (process.env.MODIFF_ROUTE_CANDIDATES_ONLY !== '1') {
    assert.equal(
      [...compilerSuccesses.values()].filter(({ definition }) => definition.provider === 'diffusers').length,
      process.env.MODIFF_GENERATE_ROUTE_CANDIDATES === '1'
        ? routeModule.REGISTERED_BLOCK_V2_ROUTES.filter(({ provider }) => provider === 'diffusers').length
        : expectedDiffusersCount,
    );
  }
  assert.equal(
    [...compilerSuccesses.values()].filter(({ definition }) => definition.provider === 'transformers').length,
    expectedTransformersCount,
  );
  const exactModularSuccesses = [...compilerSuccesses.values()].filter(
    ({ definition }) =>
      definition.provider === 'diffusers' &&
      definition.definitionKind === 'modular_pipeline_workflow' &&
      definition.integrationStatus !== 'equivalent_standard_route',
  );
  if (process.env.MODIFF_ROUTE_CANDIDATES_ONLY !== '1')
    assert.equal(exactModularSuccesses.length, 73, 'the complete currently admitted exact Modular route set drifted');
  exactModularSuccesses.forEach(({ definition, compiledDefinition }) => {
    const exactSteps = compiledDefinition.graph.nodes.filter(
      (node) => node.data.module === 'modules.ModularDiffusers' && node.data.action === 'ReviewedModularWorkflowStep',
    );
    assert.equal(
      exactSteps.length,
      definition.blockPlacements.length,
      `${definition.id} did not project every selected upstream placement exactly once`,
    );
    assert.ok(
      exactSteps.every((node) => node.modularDiffusers?.kind === 'upstream_block'),
      `${definition.id} contains an unowned generic reviewed step`,
    );
    // A scheduler step writes the strength-adjusted inference count into
    // Pipeline State. Reinjecting the caller's original count at the loop
    // overwrites that derived value (the live 50-step / 0.65 case ran 33
    // timesteps while incorrectly advertising a 50-step loop).
    if (definition.pipelineClass === 'QwenImageModularPipeline') {
      const scheduler = exactSteps.find(
        (node) => node.modularDiffusers.blockClass === 'QwenImageSetTimestepsWithStrengthStep',
      );
      if (scheduler) {
        const loop = exactSteps.find((node) => node.modularDiffusers.blockKind === 'loop');
        assert.ok(loop, `${definition.id} has no loop`);
        const inheritedSteps = loop.data.params.num_inference_steps;
        if (inheritedSteps !== undefined) {
          assert.equal(inheritedSteps.display, 'input', 'derived steps may only be an explicit connection');
          assert.equal(inheritedSteps.value, undefined, `${definition.id} overwrites the scheduler-derived count`);
          assert.equal(inheritedSteps.default, undefined, `${definition.id} defaults the scheduler-derived count`);
        }
        assert.ok(scheduler.data.params.num_inference_steps, 'the requested step control must remain on its owner');
      }
    }
    if (definition.workflowId === 'default') {
      exactSteps.forEach((node) => {
        assert.deepEqual(
          node.data.params.placement_path?.value,
          node.modularDiffusers.placementPath,
          `${definition.id} flattened the fixed block runtime path for ${node.semanticRole}`,
        );
      });
    }
  });
  exactModularSuccesses.forEach(({ definition, compiledDefinition, routeCandidate }) => {
    const outgoing = new Map();
    compiledDefinition.graph.edges.forEach((edge) => {
      outgoing.set(edge.sourceNodeId, [...(outgoing.get(edge.sourceNodeId) ?? []), edge.targetNodeId]);
    });
    const reaches = (sourceNodeId, targetNodeId) => {
      const pending = [...(outgoing.get(sourceNodeId) ?? [])];
      const visited = new Set();
      while (pending.length > 0) {
        const current = pending.pop();
        if (current === targetNodeId) return true;
        if (visited.has(current)) continue;
        visited.add(current);
        pending.push(...(outgoing.get(current) ?? []));
      }
      return false;
    };
    routeCandidate?.boundary.outputs
      .filter(({ adaptation }) => adaptation === 'direct_media')
      .forEach(({ portId }) => {
        const publicOutput = compiledDefinition.boundary.outputs.find((output) => output.portId === portId);
        assert.ok(publicOutput, `${definition.id} lost reviewed public media output ${portId}`);
        const fieldId = publicOutput.binding.fieldOrPortId;
        const selectedWriters = compiledDefinition.graph.nodes.filter(
          (node) =>
            node.modularDiffusers?.kind === 'upstream_block' && node.data.params?.[fieldId]?.display === 'output',
        );
        if (selectedWriters.length <= 1) return;
        const terminalWriters = selectedWriters.filter(
          (writer) => !selectedWriters.some((other) => other !== writer && reaches(writer.nodeId, other.nodeId)),
        );
        assert.equal(
          terminalWriters.length,
          1,
          `${definition.id} ${portId} does not have one unambiguous final selected media writer`,
        );
        assert.equal(
          publicOutput.binding.nodeId,
          terminalWriters[0].nodeId,
          `${definition.id} ${portId} targets an intermediate writer instead of the final selected postprocessor`,
        );
      });
  });
  [...compilerSuccesses.values()]
    .filter(({ definition }) => definition.integrationStatus === 'equivalent_standard_route')
    .forEach(({ definition, compiledDefinition }) => {
      assert.equal(
        compiledDefinition.graph.nodes.some(
          (node) =>
            node.data.module === 'modules.ModularDiffusers' && node.data.action === 'ReviewedModularWorkflowStep',
        ),
        false,
        `${definition.id} falsely presents an equivalent standard executor as exact upstream blocks`,
      );
    });
  const qwenDefinition = snapshot.library.definitions.find(
    (definition) => definition.id === 'diffusers.modular:QwenImageModularPipeline:text2image',
  );
  const qwen = compilerSuccesses.get(
    [
      qwenDefinition?.id,
      qwenDefinition?.contentHash,
      'diffusers.cluster-admission:QwenImageModularPipeline:text2image:mode:text_to_image',
    ].join('\0'),
  );
  assert.ok(qwen, 'the exact Qwen text-to-image route was not audited');
  const qwenModels = qwen.skeleton.nodes.find((node) => node.data.huggingFaceClusterExecutionRole === 'models');
  assert.ok(qwenModels, 'the finalized Qwen ModelsLoader is absent');
  assert.ok(
    Object.prototype.hasOwnProperty.call(qwenModels.data.params.model_type.options, 'QwenImageModularPipeline'),
    'Qwen finalization did not publish the source-owned pipeline option',
  );
  assert.deepEqual(qwenModels.data.params.repo_id.fieldOptions.filter, {
    hub: { className: ['QwenImageModularPipeline'] },
  });
  assert.equal(qwenModels.data.params.dtype.value, 'bfloat16');
  const qwenGraphNodes = qwen.compiledDefinition.graph.nodes;
  const qwenContainers = qwenGraphNodes.filter((node) => node.nodeType === 'group');
  const qwenUpstreamPaths = new Set(
    qwenGraphNodes.flatMap((node) =>
      node.modularDiffusers?.kind === 'upstream_block' ? [node.modularDiffusers.placementPath.join('/')] : [],
    ),
  );
  assert.ok(qwenContainers.length >= 4, 'the selected Qwen hierarchy did not retain its active structural containers');
  assert.equal(qwenUpstreamPaths.has('vae_encoder'), false, 'text-to-image exposed the skipped optional VAE encoder');
  assert.equal(
    qwenUpstreamPaths.has('controlnet_vae_encoder'),
    false,
    'text-to-image exposed the skipped optional ControlNet VAE encoder',
  );
  assert.ok(qwenUpstreamPaths.has('text_encoder'));
  assert.ok(qwenUpstreamPaths.has('text_encoder/text_encoder'));
  assert.ok(qwenUpstreamPaths.has('denoise/text2image/denoise/denoiser'));
  assert.ok(qwenUpstreamPaths.has('decode/decode/postprocess'));
  assert.ok(
    Math.max(
      ...qwenGraphNodes.flatMap((node) =>
        node.modularDiffusers?.placementPath ? [node.modularDiffusers.placementPath.length] : [],
      ),
    ) >= 4,
    'the Qwen definition flattened its reviewed nested placement paths',
  );
  const qwenRoute = routeModule.registeredBlockV2Route(qwen.definition, qwen.admission);
  if (process.env.MODIFF_GENERATE_ROUTE_CANDIDATES !== '1') assert.ok(qwenRoute);
  if (process.env.MODIFF_GENERATE_ROUTE_CANDIDATES !== '1') {
    const qwenExecutionSpec = specs.get(qwen.admission.studioExecutionSpec.id);
    const qwenReviewedStep =
      snapshot.registries[qwenExecutionSpec.id]['modules.ModularDiffusers.ReviewedModularWorkflowStep'];
    const exactOnce = reviewedModularGraphModule.reviewedModularGraphV2(
      qwen.definition,
      qwen.skeleton,
      qwenRoute,
      snapshot.library.blockDefinitions,
      qwenReviewedStep,
      modularConditionalModule.parseHuggingFaceModularConditionalSnapshot(snapshot.modularConditionalSnapshot),
      snapshot.library.blockRoleAdapters,
    );
    const staleSkeleton = structuredClone(exactOnce.skeleton);
    const staleSource = staleSkeleton.nodes.find((node) =>
      node.data.huggingFaceClusterExecutionRole?.startsWith('upstream:'),
    );
    assert.ok(staleSource, 'the Qwen exact graph has no upstream node for the stale-role migration check');
    const staleRole = 'upstream:stale-skipped-optional-branch';
    staleSkeleton.nodes.push({
      ...structuredClone(staleSource),
      id: `${staleSource.id}:stale`,
      data: {
        ...structuredClone(staleSource.data),
        huggingFaceClusterExecutionRole: staleRole,
      },
    });
    staleSkeleton.nodeIdsByRole[staleRole] = `${staleSource.id}:stale`;
    const exactTwice = reviewedModularGraphModule.reviewedModularGraphV2(
      qwen.definition,
      staleSkeleton,
      qwenRoute,
      snapshot.library.blockDefinitions,
      qwenReviewedStep,
      modularConditionalModule.parseHuggingFaceModularConditionalSnapshot(snapshot.modularConditionalSnapshot),
      snapshot.library.blockRoleAdapters,
    );
    assert.equal(
      exactTwice.skeleton.nodes.some((node) => node.data.huggingFaceClusterExecutionRole === staleRole),
      false,
      're-finalization preserved an obsolete skipped upstream placement as infrastructure',
    );
    assert.ok(exactTwice.skeleton.nodeIdsByRole.models, 're-finalization removed the model-loader infrastructure');
    assert.ok(exactTwice.skeleton.nodeIdsByRole.preview, 're-finalization removed preview infrastructure');
    assert.equal(qwen.compiledDefinition.contentHash, qwenRoute.compiledDefinitionContentHash);
    assert.equal(
      `sha256:${createHash('sha256')
        .update(blockSchema.canonicalBlockStringifyV2(blockSchema.canonicalBlockDefinitionV2(qwen.compiledDefinition)))
        .digest('hex')}`,
      qwenRoute.compiledDefinitionCanonicalSha256,
      'the audited Qwen final definition must equal the hash accepted by the hidden compiler',
    );
  }
  const qwenLayeredDefinition = snapshot.library.definitions.find(
    (definition) => definition.id === 'diffusers.modular:QwenImageLayeredModularPipeline:default',
  );
  const qwenLayeredAdmission = qwenLayeredDefinition?.executionAdmissions.find(
    ({ id }) => id === 'diffusers.cluster-admission:QwenImageLayeredModularPipeline:default:mode:layer_decomposition',
  );
  const qwenLayeredCompiled = compilerSuccesses.get(compilerRouteKey(qwenLayeredDefinition, qwenLayeredAdmission));
  const qwenLayeredRoute =
    process.env.MODIFF_GENERATE_ROUTE_CANDIDATES === '1'
      ? qwenLayeredCompiled?.routeCandidate
      : routeModule.registeredBlockV2Route(qwenLayeredDefinition, qwenLayeredAdmission);
  assert.ok(qwenLayeredRoute, 'the exact Qwen Layered route was not audited');
  assert.deepEqual(
    qwenLayeredRoute.controlFanOuts.find(({ source }) => source === 'resolution'),
    {
      source: 'resolution',
      persistence: 'instance_input',
      primary: { role: 'imageEncode', fieldId: 'resolution' },
      mirrors: [{ role: 'prompt', fieldId: 'resolution' }],
    },
    'one public Layered resolution must feed both upstream Modular Diffusers consumers',
  );
  if (process.env.MODIFF_ROUTE_CANDIDATES_ONLY !== '1') {
    assert.ok(qwenLayeredCompiled, 'the exact Qwen Layered route did not compile');
    assert.deepEqual(
      qwenLayeredCompiled.compiledDefinition.controls.find(({ controlId }) => controlId === 'layers')?.mirrorBindings,
      [
        { nodeId: 'upstream:denoise.after_denoise', fieldId: 'layers' },
        { nodeId: 'upstream:denoise.prepare_latents', fieldId: 'layers' },
        { nodeId: 'upstream:denoise.prepare_rope_inputs', fieldId: 'layers' },
      ],
      'one public Layered layer count must feed every selected upstream Modular Diffusers consumer',
    );
  }
  assert.deepEqual(
    qwenLayeredRoute.boundary.inputs.find(({ portId }) => portId === 'resolution'),
    { portId: 'resolution', role: 'imageEncode', fieldId: 'resolution' },
  );
  if (process.env.MODIFF_AUDIT_DISCOVERY !== '1') assert.ok(compilerSuccesses.size >= routed.length);
  if (process.env.MODIFF_AUDIT_DISCOVERY === '1' && process.env.MODIFF_ROUTE_CANDIDATES_ONLY !== '1') {
    process.stderr.write(
      `${JSON.stringify(
        {
          compilerSuccesses: [...compilerSuccesses.values()].map(({ definition, admission }) => ({
            definitionId: definition.id,
            definitionContentHash: definition.contentHash,
            provider: definition.provider,
            pipelineClass: definition.pipelineClass,
            workflowId: definition.workflowId,
            admissionId: admission.id,
          })),
          failures,
          staleRoutes,
          ...(process.env.MODIFF_GENERATE_ROUTE_CANDIDATES === '1' ? { routeCandidates } : {}),
        },
        null,
        2,
      )}\n`,
    );
  }
  if (process.env.MODIFF_ROUTE_CANDIDATES_ONLY === '1') {
    const filter = process.env.MODIFF_ROUTE_CANDIDATE_FILTER;
    const selectedCandidates = filter
      ? routeCandidates.filter((candidate) => candidate.definitionId.includes(filter))
      : routeCandidates;
    const successes = selectedCandidates.filter((candidate) => !candidate.candidateError);
    const blocked = selectedCandidates.filter((candidate) => candidate.candidateError);
    const candidateReport = {
      schemaVersion: 1,
      format: 'modiff.registered-block-v2-route-candidates.v1',
      postPromotionAdmissionId: process.env.MODIFF_POST_PROMOTION_ADMISSION_ID || null,
      counts: {
        existing: compilerSuccesses.size,
        candidateSuccesses: successes.length,
        blocked: blocked.length,
        total: compilerSuccesses.size + successes.length + blocked.length,
      },
      existingPins: [...compilerSuccesses.values()].map(
        ({
          definition,
          admission,
          skeleton,
          compiledDefinition,
          compiledInstance,
          blockDefinitionContentHash,
          blockDefinitionCanonicalSha256,
          routeCandidate,
        }) => {
          const previous = routeModule.registeredBlockV2Route(definition, admission);
          return {
            definitionId: definition.id,
            definitionContentHash: definition.contentHash,
            integrationStatus: definition.integrationStatus,
            graphAdapter: definition.graphAdapterContracts.find(({ id }) => id === admission.adapterContractId),
            admissionId: admission.id,
            previousCompiledDefinitionContentHash: previous?.compiledDefinitionContentHash ?? null,
            previousCompiledDefinitionCanonicalSha256: previous?.compiledDefinitionCanonicalSha256 ?? null,
            compiledDefinitionContentHash: blockDefinitionContentHash,
            compiledDefinitionCanonicalSha256: blockDefinitionCanonicalSha256,
            executionGraphHash: compiledDefinition.graph.graphHash,
            interfaceHash: blockSchema.blockInterfaceHashV2(compiledDefinition),
            routeCandidate: routeCandidate
              ? {
                  ...routeCandidate,
                  compiledDefinitionContentHash: blockDefinitionContentHash,
                  compiledDefinitionCanonicalSha256: blockDefinitionCanonicalSha256,
                }
              : null,
            ...(process.env.MODIFF_ROUTE_CANDIDATES_FULL === '1'
              ? {
                  diagnostic: routeCandidateDiagnostic(definition, skeleton),
                  compiledDefinition,
                  compiledValues: compiledInstance.values,
                  compiledInternalLayout: compiledInstance.presentation.internalLayout,
                  compiledInternalLayoutMode: compiledInstance.presentation.internalLayoutMode ?? 'root',
                  compiledGraph: compiledDefinition.graph,
                  compiledBoundary: compiledDefinition.boundary,
                }
              : {}),
          };
        },
      ),
      candidateSuccesses:
        process.env.MODIFF_ROUTE_CANDIDATES_FULL === '1'
          ? successes
          : successes.map((candidate) => ({
              definitionId: candidate.definitionId,
              admissionId: candidate.admissionId,
              controlFanOuts: candidate.controlFanOuts.length,
              publicInputs: candidate.boundary.inputs.length,
              publicOutputs: candidate.boundary.outputs.length,
            })),
      blocked: blocked.map((candidate) => ({
        definitionId: candidate.definitionId,
        admissionId: candidate.admissionId,
        ...(candidate.originalError ? { originalError: candidate.originalError } : {}),
        error: candidate.candidateError,
        ...(candidate.diagnostic ? { diagnostic: candidate.diagnostic } : {}),
      })),
    };
    const serializedCandidateReport = `${JSON.stringify(candidateReport, null, 2)}\n`;
    if (process.env.MODIFF_ROUTE_CANDIDATE_OUTPUT) {
      writeFileSync(path.resolve(process.env.MODIFF_ROUTE_CANDIDATE_OUTPUT), serializedCandidateReport, 'utf8');
    }
    process.stdout.write(serializedCandidateReport);
  }
});

test('registered route identity fails closed on catalog, artifact, spec, admission, and action drift', () => {
  if (process.env.MODIFF_POST_PROMOTION_ADMISSION_ID) {
    assert.equal(process.env.MODIFF_GENERATE_ROUTE_CANDIDATES, '1');
    return;
  }
  const definition = snapshot.library.definitions.find(
    ({ id }) => id === 'diffusers.modular:QwenImageModularPipeline:text2image',
  );
  assert.ok(definition);
  const admission = definition.executionAdmissions.find(
    ({ id }) => id === 'diffusers.cluster-admission:QwenImageModularPipeline:text2image:mode:text_to_image',
  );
  assert.ok(admission);
  assert.ok(routeModule.registeredBlockV2Route(definition, admission));

  const mutations = [
    (candidate) => {
      candidate.schemaVersion = 5;
    },
    (candidate) => {
      candidate.contentHash = `sha256:${'0'.repeat(64)}`;
    },
    (candidate) => {
      candidate.libraryRevision = 'main';
    },
    (candidate) => {
      candidate.executionAdmissions[0].artifact.revision = 'main';
    },
    (candidate) => {
      candidate.executionAdmissions[0].studioExecutionSpec.contentHash = 'studio-spec-v1-00000000';
    },
    (candidate) => {
      candidate.executionAdmissions[0].dynamicFieldActions[0].field = 'different_field';
    },
    (candidate) => {
      candidate.executionAdmissions[0].status = 'rejected';
    },
  ];
  mutations.forEach((mutate) => {
    const changed = structuredClone(definition);
    mutate(changed);
    const changedAdmission = changed.executionAdmissions.find(({ id }) => id === admission.id);
    assert.equal(routeModule.registeredBlockV2Route(changed, changedAdmission), null);
  });
});
