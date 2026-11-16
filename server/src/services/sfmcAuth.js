/**
 * SFMC OAuth2 authentication service.
 * Handles token acquisition, refresh, and per-org credential management.
 */

const axios = require('axios');
const NodeCache = require('node-cache');

// Cache tokens per org with TTL slightly under SFMC's 20-min window
const tokenCache = new NodeCache({ stdTTL: 1100, checkperiod: 60 });

/**
 * Exchange client credentials for an access token.
 * @param {object} creds - { clientId, clientSecret, subdomain, accountId? }
 * @returns {{ accessToken, restBaseUrl, soapBaseUrl, expiresIn }}
 */
async function getAccessToken(creds) {
  const { clientId, clientSecret, subdomain, accountId } = creds;
  const cacheKey = `token:${clientId}`;
  const cached = tokenCache.get(cacheKey);
  if (cached) return cached;

  const authUrl = `https://${subdomain}.auth.marketingcloudapis.com/v2/token`;

  const body = {
    grant_type: 'client_credentials',
    client_id: clientId,
    client_secret: clientSecret,
  };
  if (accountId) body.account_id = accountId;

  const { data } = await axios.post(authUrl, body, {
    headers: { 'Content-Type': 'application/json' },
    timeout: 10000,
  });

  const result = {
    accessToken: data.access_token,
    restBaseUrl: (data.rest_instance_url || `https://${subdomain}.rest.marketingcloudapis.com`).replace(/\/$/, ''),
    soapBaseUrl: (data.soap_instance_url || `https://${subdomain}.soap.marketingcloudapis.com`).replace(/\/$/, ''),
    expiresIn: data.expires_in || 1200,
  };

  tokenCache.set(cacheKey, result, result.expiresIn - 60);
  return result;
}

/**
 * Invalidate cached token for an org (e.g. after credential update).
 */
function clearToken(clientId) {
  tokenCache.del(`token:${clientId}`);
}

/**
 * Build an authenticated axios instance for REST calls.
 */
async function restClient(creds) {
  const { accessToken, restBaseUrl } = await getAccessToken(creds);
  return axios.create({
    baseURL: restBaseUrl,
    headers: {
      Authorization: `Bearer ${accessToken}`,
      'Content-Type': 'application/json',
    },
    timeout: 30000,
  });
}

/**
 * Build SOAP 1.2 envelope with fueloauth token header (SFMC standard OAuth2 auth).
 */
async function soapEnvelope(creds, body) {
  const { accessToken, soapBaseUrl } = await getAccessToken(creds);
  const xml = `<?xml version="1.0" encoding="UTF-8"?>
<s:Envelope xmlns:s="http://www.w3.org/2003/05/soap-envelope"
            xmlns:a="http://schemas.xmlsoap.org/ws/2004/08/addressing">
  <s:Header>
    <a:Action s:mustUnderstand="1">Retrieve</a:Action>
    <a:To s:mustUnderstand="1">${soapBaseUrl}/Service.asmx</a:To>
    <fueloauth xmlns="http://exacttarget.com">${accessToken}</fueloauth>
  </s:Header>
  <s:Body>${body}</s:Body>
</s:Envelope>`;

  return { xml, soapBaseUrl };
}

module.exports = { getAccessToken, clearToken, restClient, soapEnvelope };
