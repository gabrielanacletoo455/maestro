async function request(method, url, body) {
  const res = await fetch(url, {
    method,
    headers: body ? { 'Content-Type': 'application/json' } : undefined,
    body: body ? JSON.stringify(body) : undefined,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? `${method} ${url} falhou`);
  return data;
}

export const api = {
  sidebar: () => request('GET', '/api/pages'),
  trash: () => request('GET', '/api/trash'),
  page: (id) => request('GET', `/api/pages/${id}`),
  createPage: (body) => request('POST', '/api/pages', body),
  updatePage: (id, patch) => request('PATCH', `/api/pages/${id}`, patch),
  deletePage: (id) => request('DELETE', `/api/pages/${id}`),
  restorePage: (id) => request('POST', `/api/pages/${id}/restore`, {}),
  purgePage: (id) => request('DELETE', `/api/pages/${id}/purge`),

  createBlock: (pageId, body) => request('POST', `/api/pages/${pageId}/blocks`, body),
  updateBlock: (id, patch) => request('PATCH', `/api/blocks/${id}`, patch),
  deleteBlock: (id) => request('DELETE', `/api/blocks/${id}`),
  reorderBlocks: (pageId, ids) => request('PUT', `/api/pages/${pageId}/blocks/order`, { ids }),
  replaceBlocks: (pageId, blocks) => request('PUT', `/api/pages/${pageId}/blocks`, { blocks }),

  search: (q) => request('GET', `/api/search?q=${encodeURIComponent(q)}`),

  async uploadImage(file) {
    const res = await fetch('/api/uploads', {
      method: 'POST',
      headers: {
        'Content-Type': file.type || 'application/octet-stream',
        'X-Filename': encodeURIComponent(file.name || 'imagem'),
      },
      body: file,
    });
    const data = await res.json().catch(() => ({}));
    if (!res.ok) throw new Error(data.error ?? 'Falha no upload');
    return data;
  },

  exportUrl: () => '/api/export',
};
