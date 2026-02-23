import { request } from '@/api/httpClient';

export const directoryClient = {
  buildQuery(params = {}) {
    const searchParams = new URLSearchParams();

    if (params.mode) {
      searchParams.set('mode', String(params.mode));
    }

    if (params.q) {
      searchParams.set('q', String(params.q));
    }

    if (params.page) {
      searchParams.set('page', String(params.page));
    }

    if (params.pageSize) {
      searchParams.set('pageSize', String(params.pageSize));
    }

    const filters = params.filters && typeof params.filters === 'object' ? params.filters : {};

    if (filters.user_type) {
      searchParams.set('user_type', String(filters.user_type));
    }

    if (filters.org_type) {
      searchParams.set('org_type', String(filters.org_type));
    }

    if (filters.industry) {
      searchParams.set('industry', String(filters.industry));
    }

    if (filters.location) {
      searchParams.set('location', String(filters.location));
    }

    return searchParams.toString();
  },

  async search(params = {}) {
    const query = this.buildQuery(params);
    return request(`/api/directory/search${query ? `?${query}` : ''}`);
  },

  async getDetail(kind, id) {
    const searchParams = new URLSearchParams();
    searchParams.set('kind', String(kind || ''));
    searchParams.set('id', String(id || ''));

    return request(`/api/directory/detail?${searchParams.toString()}`);
  },
};
