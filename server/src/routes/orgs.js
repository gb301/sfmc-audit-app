const express = require('express');
const { v4: uuidv4 } = require('uuid');
const { orgs, auditLog } = require('../services/db');
const { getAccessToken, clearToken } = require('../services/sfmcAuth');

const router = express.Router();

// List all orgs
router.get('/', (req, res) => {
  res.json(orgs.list());
});

// Add new org
router.post('/', async (req, res) => {
  const { name, subdomain, clientId, clientSecret, accountId } = req.body;
  if (!name || !subdomain || !clientId || !clientSecret) {
    return res.status(400).json({ error: 'name, subdomain, clientId, clientSecret required' });
  }

  // Test credentials before saving
  try {
    await getAccessToken({ clientId, clientSecret, subdomain, accountId });
  } catch (err) {
    return res.status(401).json({ error: 'SFMC authentication failed — check credentials', detail: err.message });
  }

  const id = uuidv4();
  orgs.create({ id, name, subdomain, client_id: clientId, client_secret: clientSecret, account_id: accountId || null });
  auditLog.append({ org_id: id, run_id: null, action: 'ORG_CREATED', actor: 'user', detail: `Org "${name}" added` });
  res.status(201).json({ id, name, subdomain });
});

// Update org
router.put('/:id', async (req, res) => {
  const { name, subdomain, clientId, clientSecret, accountId } = req.body;
  const org = orgs.get(req.params.id);
  if (!org) return res.status(404).json({ error: 'Org not found' });

  const updated = {
    name:          name          || org.name,
    subdomain:     subdomain     || org.subdomain,
    client_id:     clientId      || org.client_id,
    client_secret: clientSecret  || org.client_secret,
    account_id:    accountId     != null ? accountId : org.account_id,
  };

  if (clientId || clientSecret || subdomain) {
    clearToken(updated.client_id);
    try {
      await getAccessToken({ clientId: updated.client_id, clientSecret: updated.client_secret, subdomain: updated.subdomain, accountId: updated.account_id });
    } catch (err) {
      return res.status(401).json({ error: 'SFMC authentication failed with new credentials', detail: err.message });
    }
  }

  orgs.update(req.params.id, updated);
  auditLog.append({ org_id: req.params.id, run_id: null, action: 'ORG_UPDATED', actor: 'user', detail: `Org "${updated.name}" updated` });
  res.json({ id: req.params.id, ...updated });
});

// Delete org
router.delete('/:id', (req, res) => {
  const org = orgs.get(req.params.id);
  if (!org) return res.status(404).json({ error: 'Org not found' });
  clearToken(org.client_id);
  orgs.delete(req.params.id);
  auditLog.append({ org_id: req.params.id, run_id: null, action: 'ORG_DELETED', actor: 'user', detail: `Org "${org.name}" deleted` });
  res.json({ deleted: true });
});

// Test connection
router.post('/:id/test', async (req, res) => {
  const org = orgs.get(req.params.id);
  if (!org) return res.status(404).json({ error: 'Org not found' });
  try {
    clearToken(org.client_id);
    const token = await getAccessToken({ clientId: org.client_id, clientSecret: org.client_secret, subdomain: org.subdomain, accountId: org.account_id });
    res.json({ success: true, restBaseUrl: token.restBaseUrl });
  } catch (err) {
    res.status(401).json({ success: false, error: err.message });
  }
});

module.exports = router;
