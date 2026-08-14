import config from '../../app.config';
import { requestJson } from '../utils/requestJson';

const REVISION = /^[0-9a-f]{40}$/;
const ASSET_SET_ID = /^sha256:canonical-json:[0-9a-f]{64}$/;
const REPO_ID = /^[A-Za-z0-9][A-Za-z0-9._-]*\/[A-Za-z0-9][A-Za-z0-9._-]*$/;
const STATUSES = new Set(['installing', 'missing', 'ready', 'repair_required', 'unavailable']);

function record(value: unknown, label: string) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}

function text(value: unknown, label: string, pattern?: RegExp) {
  if (typeof value !== 'string' || !value || value.length > 512 || (pattern && !pattern.test(value))) {
    throw new Error(`${label} is invalid.`);
  }
  return value;
}

function nonnegativeInteger(value: unknown, label: string) {
  if (!Number.isSafeInteger(value) || Number(value) < 0) throw new Error(`${label} is invalid.`);
  return Number(value);
}

function boolean(value: unknown, label: string) {
  if (typeof value !== 'boolean') throw new Error(`${label} is invalid.`);
  return value;
}

export type TemplateGalleryInstallStatus = {
  status: 'installing' | 'missing' | 'ready' | 'repair_required' | 'unavailable';
  installed: boolean;
  complete: boolean;
  repairRequired: boolean;
  installing: boolean;
  repoId?: string;
  revision?: string;
  assetSetId?: string;
  assetCount?: number;
  totalBytes?: number;
  code?: string;
  message?: string;
};

export function parseTemplateGalleryInstallStatus(value: unknown): TemplateGalleryInstallStatus {
  const payload = record(value, 'Template Gallery status');
  if (payload.error !== false || payload.schemaVersion !== 1) {
    throw new Error('Template Gallery status reports an unsupported contract.');
  }
  const status = text(payload.status, 'Template Gallery status');
  if (!STATUSES.has(status)) throw new Error('Template Gallery status is unknown.');
  const normalized: TemplateGalleryInstallStatus = {
    status: status as TemplateGalleryInstallStatus['status'],
    installed: boolean(payload.installed, 'Template Gallery installed state'),
    complete: boolean(payload.complete, 'Template Gallery completion state'),
    repairRequired: boolean(payload.repairRequired, 'Template Gallery repair state'),
    installing: boolean(payload.installing, 'Template Gallery installation state'),
    ...(payload.repoId === undefined ? {} : { repoId: text(payload.repoId, 'Template Gallery repository', REPO_ID) }),
    ...(payload.revision === undefined
      ? {}
      : { revision: text(payload.revision, 'Template Gallery revision', REVISION) }),
    ...(payload.assetSetId === undefined
      ? {}
      : { assetSetId: text(payload.assetSetId, 'Template Gallery asset set', ASSET_SET_ID) }),
    ...(payload.assetCount === undefined
      ? {}
      : { assetCount: nonnegativeInteger(payload.assetCount, 'Template Gallery asset count') }),
    ...(payload.totalBytes === undefined
      ? {}
      : { totalBytes: nonnegativeInteger(payload.totalBytes, 'Template Gallery byte size') }),
    ...(payload.code === undefined ? {} : { code: text(payload.code, 'Template Gallery status code') }),
    ...(payload.message === undefined ? {} : { message: text(payload.message, 'Template Gallery status message') }),
  };
  if (
    (normalized.status === 'ready' &&
      (!normalized.installed || !normalized.complete || normalized.repairRequired || normalized.installing)) ||
    (normalized.status === 'missing' && (normalized.installed || normalized.complete || normalized.repairRequired)) ||
    (normalized.status === 'repair_required' && !normalized.repairRequired) ||
    (normalized.status === 'installing' && !normalized.installing) ||
    (normalized.status !== 'unavailable' && (!normalized.repoId || !normalized.revision || !normalized.assetSetId)) ||
    (normalized.status === 'ready' && (normalized.assetCount === undefined || normalized.totalBytes === undefined))
  ) {
    throw new Error('Template Gallery status fields conflict.');
  }
  return normalized;
}

export type TemplateGalleryInstallPlan = {
  repoId: string;
  repoType: 'dataset';
  revision: string;
  assetSetId: string;
  assetCount: number;
  totalBytes: number;
  downloadBytes: number;
  stagingBytes: number;
  reservationBytes: number;
  queuedReservationBytes: number;
  reserveBytes: number;
  cacheFreeBytes: number;
  destinationFreeBytes: number;
  sameFilesystem: boolean;
  sizeKnown: boolean;
  fitsWithQueue: boolean;
  installed: boolean;
  repairRequired: boolean;
  repairReason?: string | null;
  installing: boolean;
};

export function parseTemplateGalleryInstallPlan(value: unknown): TemplateGalleryInstallPlan {
  const payload = record(value, 'Template Gallery plan');
  if (payload.error !== false || payload.schemaVersion !== 1) {
    throw new Error('Template Gallery plan reports an unsupported contract.');
  }
  const plan: TemplateGalleryInstallPlan = {
    repoId: text(payload.repoId, 'Template Gallery repository', REPO_ID),
    repoType: text(payload.repoType, 'Template Gallery repository type') as 'dataset',
    revision: text(payload.revision, 'Template Gallery revision', REVISION),
    assetSetId: text(payload.assetSetId, 'Template Gallery asset set', ASSET_SET_ID),
    assetCount: nonnegativeInteger(payload.assetCount, 'Template Gallery asset count'),
    totalBytes: nonnegativeInteger(payload.totalBytes, 'Template Gallery total bytes'),
    downloadBytes: nonnegativeInteger(payload.downloadBytes, 'Template Gallery download bytes'),
    stagingBytes: nonnegativeInteger(payload.stagingBytes, 'Template Gallery staging bytes'),
    reservationBytes: nonnegativeInteger(payload.reservationBytes, 'Template Gallery reservation bytes'),
    queuedReservationBytes: nonnegativeInteger(payload.queuedReservationBytes, 'Model queue reservation bytes'),
    reserveBytes: nonnegativeInteger(payload.reserveBytes, 'Safety reserve bytes'),
    cacheFreeBytes: nonnegativeInteger(payload.cacheFreeBytes, 'Gallery cache free bytes'),
    destinationFreeBytes: nonnegativeInteger(payload.destinationFreeBytes, 'Gallery destination free bytes'),
    sameFilesystem: boolean(payload.sameFilesystem, 'Template Gallery filesystem identity'),
    sizeKnown: boolean(payload.sizeKnown, 'Template Gallery size state'),
    fitsWithQueue: boolean(payload.fitsWithQueue, 'Template Gallery fit state'),
    installed: boolean(payload.installed, 'Template Gallery installed state'),
    repairRequired: boolean(payload.repairRequired, 'Template Gallery repair state'),
    repairReason:
      payload.repairReason === null || payload.repairReason === undefined
        ? null
        : text(payload.repairReason, 'Template Gallery repair reason'),
    installing: boolean(payload.installing, 'Template Gallery installation state'),
  };
  if (
    plan.repoType !== 'dataset' ||
    plan.reservationBytes !== plan.downloadBytes + plan.stagingBytes ||
    (plan.installed && plan.repairRequired) ||
    (plan.installed && (plan.downloadBytes !== 0 || plan.stagingBytes !== 0 || plan.reservationBytes !== 0))
  ) {
    throw new Error('Template Gallery plan fields conflict.');
  }
  return plan;
}

export type TemplateGalleryInstallResult = {
  complete: true;
  alreadyInstalled: boolean;
  plan: TemplateGalleryInstallPlan;
  result?: {
    installed: true;
    complete: true;
    repairRequired: false;
    assetCount: number;
    totalBytes: number;
    assetSetId: string;
    repoId: string;
    revision: string;
    restartRequired: boolean;
  };
};

export function parseTemplateGalleryInstallResult(value: unknown): TemplateGalleryInstallResult {
  const payload = record(value, 'Template Gallery install result');
  if (payload.error !== false || payload.complete !== true || typeof payload.alreadyInstalled !== 'boolean') {
    throw new Error('Template Gallery install did not complete.');
  }
  const plan = parseTemplateGalleryInstallPlan({
    ...record(payload.plan, 'Template Gallery result plan'),
    error: false,
  });
  if (payload.result === undefined) {
    if (!payload.alreadyInstalled) throw new Error('Template Gallery install result is missing.');
    return { complete: true, alreadyInstalled: true, plan };
  }
  const result = record(payload.result, 'Installed Template Gallery receipt');
  if (
    result.installed !== true ||
    result.complete !== true ||
    result.repairRequired !== false ||
    result.assetSetId !== plan.assetSetId ||
    result.repoId !== plan.repoId ||
    result.revision !== plan.revision ||
    result.assetCount !== plan.assetCount ||
    result.totalBytes !== plan.totalBytes
  ) {
    throw new Error('Installed Template Gallery receipt does not match its plan.');
  }
  return {
    complete: true,
    alreadyInstalled: false,
    plan,
    result: {
      installed: true,
      complete: true,
      repairRequired: false,
      assetCount: nonnegativeInteger(result.assetCount, 'Installed Template Gallery asset count'),
      totalBytes: nonnegativeInteger(result.totalBytes, 'Installed Template Gallery byte size'),
      assetSetId: text(result.assetSetId, 'Installed Template Gallery asset set', ASSET_SET_ID),
      repoId: text(result.repoId, 'Installed Template Gallery repository', REPO_ID),
      revision: text(result.revision, 'Installed Template Gallery revision', REVISION),
      restartRequired: boolean(result.restartRequired, 'Template Gallery restart requirement'),
    },
  };
}

export function fetchTemplateGalleryInstallStatus() {
  return requestJson(`${config.serverAddress}/template_gallery/status`, {
    timeoutMs: 120_000,
    parse: parseTemplateGalleryInstallStatus,
  });
}

export function fetchTemplateGalleryInstallPlan() {
  return requestJson(`${config.serverAddress}/template_gallery/plan`, {
    timeoutMs: 120_000,
    parse: parseTemplateGalleryInstallPlan,
  });
}

export function installTemplateGallery() {
  return requestJson(`${config.serverAddress}/template_gallery/install`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({}),
    timeoutMs: 24 * 60 * 60 * 1000,
    parse: parseTemplateGalleryInstallResult,
  });
}
