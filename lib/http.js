// ── lib/http.js ──────────────────────────────────────────────────────────
// Standard response envelope + backward-compatible list pagination.
'use strict';

/** Success envelope: { ok:true, data, ...extra } */
function ok(res, data, extra = {}) {
    return res.json({ ok: true, data, ...extra });
}

/** Error envelope with HTTP status: { ok:false, error, code } */
function fail(res, status, code, error) {
    return res.status(status).json({ ok: false, error, code });
}

/** True when the client opted into paginated/enveloped responses. */
function wantsEnvelope(query = {}) {
    return query.page !== undefined || query.limit !== undefined;
}

/** Parse paging params with sane defaults. */
function parsePaging(query = {}, defaultLimit = 50) {
    let page = parseInt(query.page, 10);
    let limit = parseInt(query.limit, 10);
    if (!Number.isFinite(page) || page < 1) page = 1;
    if (!Number.isFinite(limit) || limit < 1) limit = defaultLimit;
    if (limit > 500) limit = 500;
    return { page, limit };
}

/**
 * Respond with a list, preserving backward compatibility:
 *  - no page/limit param  -> raw JSON array (legacy front-end contract)
 *  - page or limit present -> { ok, data, total, page, pageSize, hasMore }
 * `items` must be the already-filtered full array.
 */
function listResponse(res, items, query = {}, defaultLimit = 50) {
    if (!wantsEnvelope(query)) {
        return res.json(items);
    }
    const { page, limit } = parsePaging(query, defaultLimit);
    const total = items.length;
    const start = (page - 1) * limit;
    const slice = items.slice(start, start + limit);
    return res.json({
        ok: true,
        data: slice,
        total,
        page,
        pageSize: limit,
        hasMore: start + limit < total,
    });
}

module.exports = { ok, fail, wantsEnvelope, parsePaging, listResponse };
