function workflowIdFromUrl(rawUrl) {
  const url = new URL(rawUrl);
  const marker = '/workflows/';
  const markerIndex = url.pathname.indexOf(marker);
  return markerIndex >= 0 ? decodeURIComponent(url.pathname.slice(markerIndex + marker.length)) : '';
}

export function createEphemeralWorkflowRouteHandler() {
  const workflows = new Map();
  let workflowRevision = 0;

  return async (route) => {
    const request = route.request();
    const workflowId = workflowIdFromUrl(request.url());
    const fulfill = (status, payload) =>
      route.fulfill({
        status,
        contentType: 'application/json',
        body: JSON.stringify(payload),
      });

    if (request.method() === 'GET' && !workflowId) {
      await fulfill(200, { workflows: Array.from(workflows.values()) });
      return;
    }
    if (request.method() === 'PUT' && workflowId) {
      const payload = request.postDataJSON() ?? {};
      const previous = workflows.get(workflowId);
      const now = Date.now();
      const workflow = {
        ...payload,
        id: workflowId,
        createdAt: typeof payload.createdAt === 'number' ? payload.createdAt : (previous?.createdAt ?? now),
        updatedAt: now,
        revision: ++workflowRevision,
      };
      workflows.set(workflowId, workflow);
      await fulfill(200, workflow);
      return;
    }
    if (request.method() === 'GET' && workflowId && workflows.has(workflowId)) {
      await fulfill(200, workflows.get(workflowId));
      return;
    }
    if (request.method() === 'DELETE' && workflowId) {
      workflows.delete(workflowId);
      await fulfill(200, { error: false });
      return;
    }
    await fulfill(404, { error: true });
  };
}

export async function installEphemeralWorkflowStorage(page) {
  // The generator is not a user editing session. Keep its workflow document
  // lifecycle in memory so startup cannot hydrate unrelated saved graphs and
  // background autosave cannot serialize each generated graph through the
  // shared backend while dynamic definitions are still settling.
  await page.route('**/workflows**', createEphemeralWorkflowRouteHandler());
  await page.addInitScript(() => {
    const generatedGraphKeys = new Set(['modiff.studio', 'modiff.flow']);
    const originalSetItem = Storage.prototype.setItem;

    Storage.prototype.setItem = function setEphemeralWorkflowItem(key, value) {
      if (this === localStorage && generatedGraphKeys.has(String(key))) return;
      return originalSetItem.call(this, key, value);
    };

    for (const key of generatedGraphKeys) {
      localStorage.removeItem(key);
    }
  });
}
