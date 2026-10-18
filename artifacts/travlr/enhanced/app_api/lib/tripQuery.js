/**
 * NEW FILE
 * - builds safe MongoDB filters, sort options, and pagination settings
 * - Every value is type checked and converted here so nothing a client
 * sends is ever passed directly to the database
 * - Because mongoose sanitizerFilter is used to sanitize user input 
 * anything a client manages to smuggle in as an operator is neutralized
 */
const { trusted } = require('mongoose');
 
const DEFAULT_LIMIT = 20;
const MAX_LIMIT = 100;
 
// Client-facing sort keys -> database fields (whitelist)
const SORT_FIELDS = {
    start: 'start',
    price: 'perPerson',
    name: 'name',
    resort: 'resort',
    code: 'code'
};
 
// Fields returned by the list endpoint (projection)
const LIST_PROJECTION = 'code name length start resort perPerson image description';
 
const escapeRegex = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
 
// Express parses ?a[b]=c into objects; only accept plain scalar strings
const scalar = (v) => (typeof v === 'string' ? v.trim() : undefined);
 
const parseDate = (raw, name, errors) => {
    if (raw === undefined || raw === '') return undefined;
    const d = new Date(raw);
    if (Number.isNaN(d.getTime())) {
        errors.push(`${name} must be a valid date (e.g. 2021-02-14)`);
        return undefined;
    }
    return d;
};
 
const parseNumber = (raw, name, errors, { min = 0, integer = false } = {}) => {
    if (raw === undefined || raw === '') return undefined;
    const n = Number(raw);
    if (!Number.isFinite(n) || n < min || (integer && !Number.isInteger(n))) {
        errors.push(`${name} must be ${integer ? 'an integer' : 'a number'} >= ${min}`);
        return undefined;
    }
    return n;
};
 
/**
 * Filter shared by the list and stats endpoints.
 * Supported: resort, q (name search), startFrom, startTo, minPrice, maxPrice
 */
function buildFilter(query = {}, errors = []) {
    const filter = {};
 
    const resort = scalar(query.resort);
    if (resort) {
        // Case-insensitive prefix match on resort; prefix-anchored so the
        // { resort, start } compound index can still be used.
        filter.resort = trusted({ $regex: '^' + escapeRegex(resort), $options: 'i' });
    }
 
    const q = scalar(query.q);
    if (q) {
        if (q.length > 100) errors.push('q must be 100 characters or fewer');
        else filter.name = trusted({ $regex: escapeRegex(q), $options: 'i' });
    }
 
    const startFrom = parseDate(scalar(query.startFrom), 'startFrom', errors);
    const startTo = parseDate(scalar(query.startTo), 'startTo', errors);
    if (startFrom || startTo) {
        filter.start = {};
        if (startFrom) filter.start.$gte = startFrom;
        if (startTo) filter.start.$lte = startTo;
        if (startFrom && startTo && startFrom > startTo) errors.push('startFrom must be before startTo');
        filter.start = trusted(filter.start);
    }
 
    const minPrice = parseNumber(scalar(query.minPrice), 'minPrice', errors);
    const maxPrice = parseNumber(scalar(query.maxPrice), 'maxPrice', errors);
    if (minPrice !== undefined || maxPrice !== undefined) {
        filter.perPerson = {};
        if (minPrice !== undefined) filter.perPerson.$gte = minPrice;
        if (maxPrice !== undefined) filter.perPerson.$lte = maxPrice;
        if (minPrice !== undefined && maxPrice !== undefined && minPrice > maxPrice) {
            errors.push('minPrice must be less than or equal to maxPrice');
        }
        filter.perPerson = trusted(filter.perPerson);
    }
 
    return filter;
}
 
/**
 * Sort: ?sort=price or ?sort=-price (descending). Default: start date ascending.
 * A unique tie-breaker (code) keeps pagination stable across pages.
 */
function buildSort(query = {}, errors = []) {
    const raw = scalar(query.sort) || 'start';
    const desc = raw.startsWith('-');
    const key = desc ? raw.slice(1) : raw;
    const field = SORT_FIELDS[key];
    if (!field) {
        errors.push(`sort must be one of: ${Object.keys(SORT_FIELDS).join(', ')} (prefix with - for descending)`);
        return { start: 1, code: 1 };
    }
    const sort = { [field]: desc ? -1 : 1 };
    if (field !== 'code') sort.code = 1;
    return sort;
}
 
function buildPagination(query = {}, errors = []) {
    const page = parseNumber(scalar(query.page), 'page', errors, { min: 1, integer: true }) || 1;
    let limit = parseNumber(scalar(query.limit), 'limit', errors, { min: 1, integer: true }) || DEFAULT_LIMIT;
    if (limit > MAX_LIMIT) limit = MAX_LIMIT;
    return { page, limit, skip: (page - 1) * limit };
}
 
module.exports = {
    buildFilter,
    buildSort,
    buildPagination,
    escapeRegex,
    LIST_PROJECTION,
    DEFAULT_LIMIT,
    MAX_LIMIT,
    SORT_FIELDS
};