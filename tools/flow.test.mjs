import assert from 'node:assert/strict';
import test from 'node:test';
import { analyzeModules } from './functions.mjs';
import {
  FLOW_BOX_CAP,
  FLOW_COLUMN_CAP,
  bodySimilarity,
  deriveFlows,
  diffFunctions,
  explainFunction,
  matchQueueTarget,
} from './flow.mjs';

const route = `
import { listInquiries } from '../services/inquiryService.js';

/** HTTP entry for listing inquiries. */
export function GET(req, res) {
  return listInquiries(req, res);
}

export function POST(req, res) {
  res.status(404).end();
}
`;

const serviceHead = `
import { matchingSearch } from './search.js';

/** Loads inquiries, filters them, and queues follow-up. */
export function listInquiries(req, res) {
  const rows = matchingSearch(req.query || {});
  enqueueJob('lead-follow-up', { inquiryId: rows[0] && rows[0].id });
  return res.json(rows);
}

export function process(mode) {
  switch (mode) {
    case 'follow':
      return followUp();
    case 'skip':
      return skipLead();
    default:
      return null;
  }
}

function followUp() { return 'follow'; }
function skipLead() { return 'skip'; }
`;

const serviceBase = `
import { searchInquiries } from './search.js';

/** Loads inquiries and notifies the legacy mailer. */
export function listInquiries(req, res) {
  const rows = searchInquiries(req.query || {});
  return res.json(rows);
}
`;

const job = `
/** Worker for the lead follow-up queue. */
export class LeadFollowUpJob {
  async perform(payload) {
    return prisma.inquiry.findMany({ where: { id: payload.inquiryId }, select: { email: true } });
  }
}
`;

const searchHead = `
/** Keeps inquiries whose email contains the search text. */
export function matchingSearch(query) {
  const needle = String(query.text || '').toLowerCase();
  const hits = [];
  if (needle) hits.push({ lead: needle, state: 'open' });
  return hits;
}
`;

function modelFrom(files, changes) {
  const parsed = analyzeModules(files);
  return {
    functions: diffFunctions(parsed.functions, parsed.functions, { changedFiles: changes }),
    calls: parsed.calls.map((call) => ({ ...call, side: 'head' })),
  };
}

test('route handlers and job classes are entry points', () => {
  const parsed = analyzeModules([
    { file: 'src/routes/inquiries.js', source: route },
    { file: 'src/services/inquiryService.js', source: serviceHead },
    { file: 'src/jobs/leadFollowUp.js', source: job },
    { file: 'src/services/search.js', source: searchHead },
  ]);
  const get = parsed.functions.find((fn) => fn.name === 'GET');
  const post = parsed.functions.find((fn) => fn.name === 'POST');
  const perform = parsed.functions.find((fn) => fn.name === 'perform');
  assert.equal(get.entryKind, 'route');
  assert.equal(get.entryLabel, 'GET /inquiries');
  assert.equal(post.entryKind, 'route');
  assert.equal(perform.entryKind, 'job');
  assert.equal(perform.className, 'LeadFollowUpJob');

  const changed = diffFunctions(
    parsed.functions.filter((fn) => fn.name !== 'matchingSearch'),
    parsed.functions,
    { changedFiles: ['src/services/search.js'] },
  );
  const view = deriveFlows({
    functions: changed,
    calls: parsed.calls.map((call) => ({ ...call, side: 'head' })),
  });
  assert.equal(view.capped, false);
  const flow = view.flows[0];
  assert.equal(flow.steps[0].entryKind, 'route');
  assert.ok(flow.steps.some((step) => step.id.endsWith('#listInquiries')));
  assert.ok(flow.columnCount >= 2);
  assert.ok(flow.columnCount <= FLOW_COLUMN_CAP);
});

test('enqueueJob matches the job class perform method', () => {
  const parsed = analyzeModules([
    { file: 'src/services/inquiryService.js', source: serviceHead },
    { file: 'src/jobs/leadFollowUp.js', source: job },
  ]);
  const perform = parsed.functions.find((fn) => fn.name === 'perform');
  assert.equal(matchQueueTarget('lead-follow-up', parsed.functions).id, perform.id);
  assert.equal(matchQueueTarget('LeadFollowUpJob', parsed.functions).id, perform.id);

  const functions = diffFunctions([], parsed.functions, {
    changedFiles: ['src/services/inquiryService.js', 'src/jobs/leadFollowUp.js'],
  });
  const view = deriveFlows({
    functions,
    calls: parsed.calls.map((call) => ({ ...call, side: 'head' })),
  });
  const queued = view.flows.flatMap((flow) => flow.edges).find((edge) => edge.kind === 'queue');
  assert.ok(queued);
  assert.equal(queued.to, perform.id);
  assert.equal(queued.label, 'queued');
  assert.equal(queued.queueName, 'lead-follow-up');

  const branched = view.flows.flatMap((flow) => flow.edges).filter((edge) => edge.mode);
  const modes = branched.map((edge) => edge.mode).sort();
  assert.deepEqual(modes, ['follow', 'skip']);
});

test('a data write links to a later read of the same table', () => {
  const writer = `
    export function saveInquiry(row) {
      return prisma.inquiry.create({ data: { email: row.email, status: 'open' } });
    }
  `;
  const reader = `
    export function loadInquiry(id) {
      return prisma.inquiry.findMany({ where: { id }, select: { email: true, status: true } });
    }
  `;
  const parsed = analyzeModules([
    { file: 'src/services/writeInquiry.js', source: writer },
    { file: 'src/services/readInquiry.js', source: reader },
  ]);
  const functions = parsed.functions.map((fn) => ({ ...fn, status: 'edited' }));
  const view = deriveFlows({
    functions,
    calls: parsed.calls.map((call) => ({ ...call, side: 'head' })),
  });
  const data = view.flows.flatMap((flow) => flow.edges).find((edge) => edge.kind === 'data');
  assert.ok(data);
  assert.equal(data.table, 'inquiry');
  assert.equal(data.label, 'data');
  assert.ok(data.columns.includes('email'));
});

test('moved bodies are not marked added, and unmatched removals stay deleted', () => {
  const base = analyzeModules([{
    file: 'src/services/legacyNotify.js',
    source: `
      /** Sends the inquiry notice email. */
      export function deliverNotice(row) {
        const email = row.email || '';
        const body = row.body || 'inquiry update';
        return mail.send(email, body);
      }
      /** Old mail path this PR removes. */
      export function sendLegacyNotice(row) {
        const email = row.email || '';
        return mail.send(email, 'legacy inquiry notice');
      }
    `,
  }]);
  const head = analyzeModules([{
    file: 'src/services/notify.js',
    source: `
      /** Sends the inquiry notice email. */
      export function deliverNotice(row) {
        const email = row.email || '';
        const body = row.body || 'inquiry update';
        return mail.send(email, body);
      }
    `,
  }]);
  assert.ok(bodySimilarity(base.functions[0].bodyNorm, head.functions[0].bodyNorm) >= 0.72);
  const functions = diffFunctions(base.functions, head.functions, {
    changedFiles: ['src/services/legacyNotify.js', 'src/services/notify.js'],
  });
  const moved = functions.find((fn) => fn.name === 'deliverNotice');
  const ghost = functions.find((fn) => fn.name === 'sendLegacyNotice');
  assert.equal(moved.status, 'moved');
  assert.match(moved.movedFromLabel, /legacyNotify\.js\/deliverNotice/);
  assert.equal(ghost.status, 'deleted');
  assert.equal(functions.some((fn) => fn.status === 'added'), false);

  const explained = explainFunction(moved);
  assert.match(explained.whatChanged, /Moved from/);
  assert.match(explained.whatItDoes, /notice email/);
  const custom = explainFunction(moved, {
    summarize: () => ({ whatItDoes: 'Custom summary.', whatChanged: 'Custom change.' }),
  });
  assert.equal(custom.whatItDoes, 'Custom summary.');
  assert.equal(custom.whatChanged, 'Custom change.');
});

test('more than 12 boxes or more than 4 columns opens the changed-function list', () => {
  const files = [];
  for (let i = 0; i < 6; i += 1) {
    const name = `step${i}`;
    const nextImport = i < 5 ? `import { step${i + 1} } from './step${i + 1}.js';` : '';
    const nextCall = i < 5 ? `return step${i + 1}();` : `return ${i};`;
    files.push({
      file: `src/wide/step${i}.js`,
      source: `
        ${nextImport}
        export function ${name}() {
          const marker${i} = 'column-${i}';
          ${nextCall}
        }
      `,
    });
  }
  const parsed = analyzeModules(files);
  const functions = parsed.functions.map((fn) => ({ ...fn, status: 'edited' }));
  const wide = deriveFlows({
    functions,
    calls: parsed.calls.map((call) => ({ ...call, side: 'head' })),
  });
  assert.ok(wide.flows[0].columnCount > FLOW_COLUMN_CAP);
  assert.equal(wide.capped, true);
  assert.equal(wide.index.length, 6);

  const callers = [];
  const leaves = [];
  for (let i = 0; i < 14; i += 1) {
    callers.push(`leaf${i}()`);
    leaves.push(`export function leaf${i}() { return ${i}; }`);
  }
  const many = [{
    file: 'src/wide/crowd.js',
    source: `
      export function GET() {
        ${callers.join(';\n        ')}
        return true;
      }
      ${leaves.join('\n      ')}
    `,
  }];
  const parsedMany = analyzeModules(many);
  const manyFns = parsedMany.functions.map((fn) => ({ ...fn, status: fn.name === 'GET' ? 'unchanged' : 'added' }));
  const crowded = deriveFlows({
    functions: manyFns,
    calls: parsedMany.calls.map((call) => ({ ...call, side: 'head' })),
  });
  assert.ok(crowded.flows[0].boxCount > FLOW_BOX_CAP);
  assert.equal(crowded.capped, true);
  assert.ok(crowded.index.length >= 14);

  const one = deriveFlows({
    functions: manyFns,
    calls: parsedMany.calls.map((call) => ({ ...call, side: 'head' })),
  }, { focusId: manyFns.find((fn) => fn.name === 'leaf0').id });
  assert.equal(one.capped, false);
  assert.ok(one.flows[0].boxCount <= FLOW_BOX_CAP);
  assert.ok(one.flows[0].steps.some((step) => step.name === 'leaf0'));
});

test('unchanged files stay unchanged when the change set is explicit', () => {
  const parsed = analyzeModules([
    { file: 'src/routes/inquiries.js', source: route },
    { file: 'src/services/inquiryService.js', source: serviceBase },
  ]);
  const head = analyzeModules([
    { file: 'src/routes/inquiries.js', source: route },
    { file: 'src/services/inquiryService.js', source: serviceHead },
  ]);
  const functions = diffFunctions(parsed.functions, head.functions, {
    changedFiles: ['src/services/inquiryService.js'],
  });
  assert.equal(functions.find((fn) => fn.name === 'GET').status, 'unchanged');
  assert.equal(functions.find((fn) => fn.name === 'listInquiries' && fn.file.includes('inquiryService')).status, 'edited');
});
