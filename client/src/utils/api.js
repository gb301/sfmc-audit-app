import axios from 'axios';

const api = axios.create({
  baseURL: '/api',
  timeout: 120000,
});

// Orgs
export const listOrgs = () => api.get('/orgs').then(r => r.data);
export const createOrg = (data) => api.post('/orgs', data).then(r => r.data);
export const updateOrg = (id, data) => api.put(`/orgs/${id}`, data).then(r => r.data);
export const deleteOrg = (id) => api.delete(`/orgs/${id}`).then(r => r.data);
export const testOrgConnection = (id) => api.post(`/orgs/${id}/test`).then(r => r.data);

// Audit
export const startRun  = (orgId) => api.post(`/audit/orgs/${orgId}/run`).then(r => r.data);
export const getRun    = (runId)  => api.get(`/audit/runs/${runId}`).then(r => r.data);
export const getRunStatus = (runId) => api.get(`/audit/runs/${runId}`).then(r => r.data);
export const listRuns = (orgId) => api.get(`/audit/orgs/${orgId}/runs`).then(r => r.data);
export const getFindings = (runId, params) => api.get(`/audit/runs/${runId}/findings`, { params }).then(r => r.data);
export const getAlerts = (orgId) => api.get(`/audit/orgs/${orgId}/alerts`).then(r => r.data);
export const spotTest = (orgId, type, id) => api.post(`/audit/orgs/${orgId}/test`, { type, id }).then(r => r.data);
export const getAuditLog    = (orgId) => api.get(`/audit/orgs/${orgId}/log`).then(r => r.data);
export const getOrgContext  = (orgId) => api.get(`/audit/orgs/${orgId}/context`).then(r => r.data);
export const previewEmail   = (orgId, emailId, deKey, rowIndex) => api.post(`/audit/orgs/${orgId}/preview-email`, { emailId, deKey, rowIndex }).then(r => r.data);
export const getSendableDEs = (orgId) => api.get(`/audit/orgs/${orgId}/sendable-des`).then(r => r.data);
