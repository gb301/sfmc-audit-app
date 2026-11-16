/**
 * Findings Engine
 * Runs deterministic rule checks across all collected context,
 * then optionally enriches findings with Claude AI narrative.
 */

const Anthropic = require('@anthropic-ai/sdk');
const { execSync } = require('child_process');
const { v4: uuidv4 } = require('uuid');

function makeClient() {
  const apiKey = process.env.ANTHROPIC_API_KEY;
  const baseURL = process.env.ANTHROPIC_BASE_URL;
  const keyHelper = process.env.ANTHROPIC_API_KEY_HELPER;

  if (apiKey && !apiKey.startsWith('sk-ant-...')) {
    return new Anthropic({ apiKey, ...(baseURL ? { baseURL } : {}) });
  }
  if (keyHelper) {
    try {
      const freshKey = execSync(keyHelper, { timeout: 5000 }).toString().trim();
      return new Anthropic({ apiKey: freshKey, ...(baseURL ? { baseURL } : {}) });
    } catch {}
  }
  if (baseURL) {
    // Try without explicit key — gateway may use ambient auth
    return new Anthropic({ apiKey: 'gateway', baseURL });
  }
  return null;
}

const client = makeClient();

// ── Finding helpers ───────────────────────────────────────────────────────────

function finding(severity, category, title, detail, remediation, entity = {}, pattern = null) {
  return {
    id: uuidv4(),
    severity,
    category,
    title,
    detail,
    remediation,
    entity_type: entity.type || null,
    entity_id:   entity.id   || null,
    entity_name: entity.name || null,
    pattern,
  };
}

// ── AMPScript analyser ────────────────────────────────────────────────────────

function analyseAMPScript(html, emailName, emailId) {
  const findings = [];
  const e = { type: 'email', id: emailId, name: emailName };

  // Mismatched delimiters
  const opens  = (html.match(/%%\[/g)  || []).length;
  const closes = (html.match(/\]%%/g)  || []).length;
  if (opens !== closes) {
    findings.push(finding('CRITICAL', 'ampscript', 'Mismatched AMPScript delimiters',
      `Found ${opens} opening %%[ and ${closes} closing ]%% — this will cause a render error.`,
      'Review all AMPScript blocks and ensure every %%[ has a matching ]%%.', e));
  }

  // Lookup without fallback
  const lookupMatch = html.match(/Lookup\s*\([^)]*\)/i);
  if (lookupMatch && !/IIF\s*\(\s*EMPTY\s*\(/i.test(html)) {
    findings.push(finding('HIGH', 'ampscript', 'Lookup() without empty-string fallback',
      'AMPScript Lookup() calls found with no IIF(EMPTY(...)) guard — will render blank for unmatched rows.',
      'Wrap every Lookup() in IIF(EMPTY(@var), "default", @var) or add a fallback parameter.', e, lookupMatch[0]));
  }

  // LookupRows without RowCount check
  const lookupRowsMatch = html.match(/LookupRows\s*\([^)]*\)/i);
  if (lookupRowsMatch && !/RowCount\s*\(/i.test(html)) {
    findings.push(finding('HIGH', 'ampscript', 'LookupRows() without RowCount check',
      'LookupRows() found without a preceding RowCount() check — iterating an empty rowset will error.',
      'Add: SET @count = RowCount(@rows); IF @count > 0 THEN ... before iterating.', e, lookupRowsMatch[0]));
  }

  // PersonalizationString without fallback
  const personTokens = [...html.matchAll(/%%=AttributeValue\s*\(['"]([^'"]+)['"]\)=%%/gi)];
  personTokens.forEach(m => {
    if (!html.includes(`IIF(EMPTY`) && !html.includes(`default=`)) {
      findings.push(finding('MEDIUM', 'ampscript', `Personalization token %%=AttributeValue("${m[1]}")=%% without fallback`,
        'Personalization will render blank if subscriber has no value for this attribute.',
        `Wrap in IIF(EMPTY(AttributeValue("${m[1]}")), "there", AttributeValue("${m[1]}")).`, e, m[0]));
    }
  });

  // HTTPGet / HTTPPost (performance risk)
  const httpMatch = html.match(/HTTPGet\s*\(|HTTPPost\s*\(/i);
  if (httpMatch) {
    findings.push(finding('MEDIUM', 'ampscript', 'HTTPGet/HTTPPost in email template',
      'HTTP calls inside AMPScript increase render time per subscriber and may hit timeouts.',
      'Cache data in a Data Extension via automation and use Lookup() instead of live HTTP calls.', e, httpMatch[0]));
  }

  // TreatAsContent (security risk)
  const tacMatch = html.match(/TreatAsContent\s*\([^)]*\)/i);
  if (tacMatch) {
    findings.push(finding('HIGH', 'ampscript', 'TreatAsContent() detected',
      'TreatAsContent() executes arbitrary AMPScript stored in a DE field — potential injection vector.',
      'Audit the source DE for untrusted input. Prefer static templates.', e, tacMatch[0]));
  }

  // FOR loop without upper bound
  const forLoops = [...html.matchAll(/FOR\s+@\w+\s*=\s*1\s+TO\s+@(\w+)/gi)];
  forLoops.forEach(m => {
    if (!html.match(new RegExp(`MIN\\s*\\(.*${m[1]}`, 'i'))) {
      findings.push(finding('LOW', 'ampscript', `FOR loop with uncapped iteration variable @${m[1]}`,
        'Unbounded FOR loops can exceed SFMC AMPScript limits (2500 iterations) and cause send failures.',
        `Cap the loop: FOR @i = 1 TO MIN(@${m[1]}, 100) DO`, e, m[0]));
    }
  });

  return findings;
}

// ── Compliance checks ─────────────────────────────────────────────────────────

function analyseCompliance(html, emailName, emailId) {
  const findings = [];
  const e = { type: 'email', id: emailId, name: emailName };

  const hasUnsub = /%%=RedirectTo\(@[Uu]nsubscribe[Ll]ink\)=%%|href[^"']*["'][^"']*(unsub|optout|opt-out)[^"']*["']/i.test(html);
  if (!hasUnsub) {
    findings.push(finding('CRITICAL', 'compliance', 'Missing unsubscribe link',
      'No unsubscribe mechanism found — violates CAN-SPAM §5 and CASL.',
      'Add %%=RedirectTo(@unsubscribelink)=%% to the email footer.', e));
  }

  const hasAddress = /\d{1,5}\s+[\w\s,.]+(?:Street|St\.?|Avenue|Ave\.?|Road|Rd\.?|Boulevard|Blvd\.?|Drive|Dr\.?|Way|Lane|Ln\.?|Place|Pl\.?)/i.test(html);
  if (!hasAddress) {
    findings.push(finding('HIGH', 'compliance', 'Missing physical mailing address',
      'CAN-SPAM requires a valid physical postal address in every commercial email.',
      'Add the registered mailing address to the email footer.', e));
  }

  const httpLinks = [...html.matchAll(/href\s*=\s*["']http:\/\/(?!img\.shields\.io)[^"']+["']/gi)];
  if (httpLinks.length > 0) {
    findings.push(finding('MEDIUM', 'compliance', `${httpLinks.length} non-HTTPS link(s)`,
      'Non-HTTPS links may trigger browser security warnings and reduce subscriber trust.',
      'Update all links to https://.', e, httpLinks[0][0]));
  }

  const testUrls = [...html.matchAll(/href\s*=\s*["'][^"']*(?:localhost|127\.0\.0\.1|staging\.|\.dev\.|\.test\.)[^"']*["']/gi)];
  if (testUrls.length > 0) {
    findings.push(finding('CRITICAL', 'compliance', `${testUrls.length} localhost/staging URL(s) in production template`,
      'Test/staging URLs will not resolve for subscribers and expose internal infrastructure.',
      'Replace all test URLs with production URLs before send.', e, testUrls[0][0]));
  }

  const imgNoAlt = [...html.matchAll(/<img(?![^>]*\balt\s*=)[^>]*>/gi)];
  if (imgNoAlt.length > 0) {
    findings.push(finding('MEDIUM', 'accessibility', `${imgNoAlt.length} image(s) missing alt text`,
      'Images without alt text fail WCAG 2.1 AA and render as broken in image-blocked inboxes.',
      'Add descriptive alt="..." or alt="" for decorative images.', e, imgNoAlt[0][0].slice(0, 60)));
  }

  return findings;
}

// ── Subject line analysis ─────────────────────────────────────────────────────

function analyseSubjectLine(subject, emailName, emailId) {
  const findings = [];
  const e = { type: 'email', id: emailId, name: emailName };
  if (!subject) return findings;

  const SPAM_TRIGGERS = ['free', 'guarantee', 'act now', 'limited time', 'urgent', 'winner', 'congratulations', 'click here', 'buy now', '!!!', '100%'];
  const triggers = SPAM_TRIGGERS.filter(t => subject.toLowerCase().includes(t));
  if (triggers.length > 0) {
    findings.push(finding('HIGH', 'subject_line', `Spam trigger word(s) in subject: "${triggers.join('", "')}"`,
      `Subject line "${subject}" contains words commonly flagged by spam filters.`,
      'Remove or rephrase spam trigger words to improve deliverability.', e));
  }

  if (subject.length > 70) {
    findings.push(finding('LOW', 'subject_line', `Subject line too long (${subject.length} chars)`,
      'Most email clients truncate subject lines over 60–70 characters.',
      'Shorten to under 60 characters for best mobile display.', e));
  }

  const capsRatio = (subject.match(/[A-Z]/g) || []).length / subject.length;
  if (capsRatio > 0.4 && subject.length > 10) {
    findings.push(finding('MEDIUM', 'subject_line', 'Excessive capitalisation in subject line',
      `${Math.round(capsRatio * 100)}% of subject line characters are uppercase — appears aggressive.`,
      'Use sentence case or title case consistently.', e));
  }

  return findings;
}

// ── Journey analysis ──────────────────────────────────────────────────────────

function analyseJourneys(journeys) {
  const findings = [];

  journeys.forEach(j => {
    const e = { type: 'journey', id: j.id, name: j.name };

    if (j.status === 'Published' && j.activityCount === 0) {
      findings.push(finding('HIGH', 'journey', 'Published journey with no activities',
        `Journey "${j.name}" is active but has no configured activities.`,
        'Add at least one activity or pause the journey.', e));
    }

    const emailActivities = (j.activities || []).filter(a => a.type === 'EMAILV2');
    if (j.status === 'Published' && emailActivities.length === 0) {
      findings.push(finding('MEDIUM', 'journey', 'Active journey with no email sends',
        `Journey "${j.name}" is running but sends no emails — may be incomplete.`,
        'Verify journey configuration is intentional.', e));
    }

    if (j.entryMode === 'MultipleEntries' && j.status === 'Published') {
      findings.push(finding('LOW', 'journey', 'Journey allows unlimited re-entry',
        `Journey "${j.name}" is set to MultipleEntries — contacts can enter simultaneously, risking over-messaging.`,
        "Consider 'OnceAndDone' or 'SingleEntryAcrossAllVersions' unless re-entry is intentional.", e));
    }
  });

  return findings;
}

// ── Automation analysis ───────────────────────────────────────────────────────

function analyseAutomations(automations) {
  const findings = [];

  automations.forEach(a => {
    const e = { type: 'automation', id: a.id, name: a.name };

    if (a.lastRunStatus === 'Error') {
      findings.push(finding('HIGH', 'automation', `Automation last run failed: "${a.name}"`,
        `Last execution of this automation ended with status "Error" on ${a.lastRunTime}.`,
        'Investigate the automation step logs for root cause.', e));
    }

    if (!a.schedule && a.status === 'Active') {
      findings.push(finding('LOW', 'automation', `Active automation with no schedule: "${a.name}"`,
        'This automation is active but has no recurrence schedule — it only runs when triggered manually or by file drop.',
        'Verify trigger configuration is intentional.', e));
    }
  });

  return findings;
}

// ── Data Extension analysis ───────────────────────────────────────────────────

function analyseDataExtensions(dataExtensions) {
  const findings = [];

  const sendable = dataExtensions.filter(d => d.isSendable);
  if (sendable.length > 50) {
    findings.push(finding('LOW', 'data_hygiene', `${sendable.length} sendable Data Extensions`,
      'Large numbers of sendable DEs can complicate governance and increase accidental-send risk.',
      'Review and archive unused sendable DEs. Apply naming conventions.', { type: 'account', id: 'account', name: 'Account-level' }));
  }

  dataExtensions.forEach(de => {
    if (de.rowCount > 5000000) {
      findings.push(finding('LOW', 'data_hygiene', `Large DE: "${de.name}" (${(de.rowCount / 1e6).toFixed(1)}M rows)`,
        'Very large DEs can slow query performance and query activity runs.',
        'Consider archiving old data or partitioning into smaller DEs.', { type: 'data_extension', id: de.customerKey, name: de.name }));
    }
  });

  return findings;
}

// ── User / access analysis ────────────────────────────────────────────────────

function analyseUsers(users) {
  const findings = [];

  const ninetyDaysAgo = new Date(Date.now() - 90 * 24 * 60 * 60 * 1000);
  const inactive = users.filter(u => u.isActive && u.lastLogin && new Date(u.lastLogin) < ninetyDaysAgo);
  if (inactive.length > 0) {
    findings.push(finding('MEDIUM', 'access_control', `${inactive.length} active user(s) with no login in 90+ days`,
      `Users who haven't logged in recently may represent stale access: ${inactive.slice(0, 5).map(u => u.name).join(', ')}${inactive.length > 5 ? '...' : ''}`,
      'Review and deactivate or remove inactive user accounts.', { type: 'account', id: 'users', name: 'User Management' }));
  }

  const mustChange = users.filter(u => u.mustChangePassword);
  if (mustChange.length > 0) {
    findings.push(finding('LOW', 'access_control', `${mustChange.length} user(s) with pending password reset`,
      `These users have never completed their initial password setup.`,
      'Follow up with users to complete account setup.', { type: 'account', id: 'users', name: 'User Management' }));
  }

  return findings;
}

// ── SQL Query analysis ────────────────────────────────────────────────────────

function analyseSQLQueries(queries) {
  const findings = [];

  queries.forEach(q => {
    const e = { type: 'sql_query', id: q.id, name: q.name };
    const sql = (q.queryText || '').toUpperCase();

    if (sql.includes('SELECT *')) {
      findings.push(finding('LOW', 'sql_quality', `SELECT * in query: "${q.name}"`,
        'SELECT * fetches all columns including future schema additions — fragile and slow.',
        'Replace SELECT * with explicit column names.', e));
    }

    if (sql.includes('ORDER BY') && !sql.includes('TOP ') && !sql.includes('OFFSET')) {
      findings.push(finding('MEDIUM', 'sql_quality', `ORDER BY without TOP in query: "${q.name}"`,
        'SFMC SQL requires TOP N or OFFSET when using ORDER BY — this query will fail at runtime.',
        'Add TOP N (e.g. TOP 500000) before the column list.', e));
    }

    if (!sql.includes('WHERE') && (sql.includes('FROM _') || sql.match(/FROM\s+\w/i))) {
      findings.push(finding('LOW', 'sql_quality', `Query with no WHERE clause: "${q.name}"`,
        'No WHERE clause means this query processes all rows in the source — may be slow or accidental.',
        'Add a WHERE clause to filter to the intended population.', e));
    }
  });

  return findings;
}

// ── Send metrics anomalies ────────────────────────────────────────────────────

function analyseSendMetrics(sends) {
  const findings = [];

  sends.forEach(s => {
    const e = { type: 'send', id: s.id, name: s.emailName };
    if (!s.sent || s.sent === 0) return;

    const bounceRate = s.bounced / s.sent;
    const unsubRate  = s.unsubscribed / s.sent;

    if (bounceRate > 0.05) {
      findings.push(finding('CRITICAL', 'deliverability', `Bounce rate ${(bounceRate * 100).toFixed(1)}% on "${s.emailName}"`,
        `${s.bounced.toLocaleString()} bounces out of ${s.sent.toLocaleString()} sends (${(bounceRate * 100).toFixed(1)}%) — well above 2% threshold.`,
        'Run list hygiene immediately. Suppress hard bounces. Review list acquisition.', e));
    }

    if (unsubRate > 0.01) {
      findings.push(finding('HIGH', 'deliverability', `Unsub rate ${(unsubRate * 100).toFixed(2)}% on "${s.emailName}"`,
        `${s.unsubscribed.toLocaleString()} unsubscribes — above 1% threshold.`,
        'Review send frequency, list segmentation, and content relevance.', e));
    }
  });

  return findings;
}

// ── Master findings runner ────────────────────────────────────────────────────

function runAllRules(context) {
  const all = [];

  (context.emails || []).forEach(em => {
    if (em.htmlContent) {
      all.push(...analyseAMPScript(em.htmlContent, em.name, em.id));
      all.push(...analyseCompliance(em.htmlContent, em.name, em.id));
      all.push(...analyseSubjectLine(em.subjectLine, em.name, em.id));
    }
  });

  all.push(...analyseJourneys(context.journeys || []));
  all.push(...analyseAutomations(context.automations || []));
  all.push(...analyseDataExtensions(context.dataExtensions || []));
  all.push(...analyseSQLQueries(context.sqlQueries || []));
  all.push(...analyseUsers(context.users || []));
  all.push(...analyseSendMetrics(context.recentSends || []));

  return all;
}

// ── Claude AI narrative ───────────────────────────────────────────────────────

async function generateAISummary(context, findings) {
  if (!client) return null;

  const counts = {
    CRITICAL: findings.filter(f => f.severity === 'CRITICAL').length,
    HIGH:     findings.filter(f => f.severity === 'HIGH').length,
    MEDIUM:   findings.filter(f => f.severity === 'MEDIUM').length,
    LOW:      findings.filter(f => f.severity === 'LOW').length,
  };

  const topFindings = findings
    .filter(f => ['CRITICAL', 'HIGH'].includes(f.severity))
    .slice(0, 10)
    .map(f => `- [${f.severity}] ${f.category}: ${f.title}`)
    .join('\n');

  const stats = {
    emails:     (context.emails || []).length,
    journeys:   (context.journeys || []).length,
    automations:(context.automations || []).length,
    users:      (context.users || []).length,
    sendDefs:   (context.sendDefinitions || []).length,
  };

  const prompt = `You are a Salesforce Marketing Cloud audit specialist. Based on the following account scan results, write a clear executive summary (3–5 paragraphs) suitable for a marketing operations director. Focus on the most important risks, their business impact, and prioritised recommendations. Use plain English — no jargon.

ACCOUNT OVERVIEW:
- ${stats.emails} email assets, ${stats.journeys} journeys, ${stats.automations} automations, ${stats.users} users, ${stats.sendDefs} send definitions

FINDINGS SUMMARY:
- CRITICAL: ${counts.CRITICAL}
- HIGH: ${counts.HIGH}
- MEDIUM: ${counts.MEDIUM}
- LOW: ${counts.LOW}

TOP FINDINGS:
${topFindings || 'No critical or high findings.'}

Write the executive summary now:`;

  const message = await client.messages.create({
    model: 'claude-sonnet-4-6',
    max_tokens: 1024,
    messages: [{ role: 'user', content: prompt }],
  });

  return message.content[0].text;
}

module.exports = {
  runAllRules,
  generateAISummary,
  analyseAMPScript,
  analyseCompliance,
  analyseSubjectLine,
};
