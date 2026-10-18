const { buildFilter, buildSort, buildPagination, escapeRegex, MAX_LIMIT } = require('../app_api/lib/tripQuery');
 
describe('tripQuery (query-string -> MongoDB query builder)', () => {
    test('empty query produces an empty filter and default sort/paging', () => {
        const errors = [];
        expect(buildFilter({}, errors)).toEqual({});
        expect(buildSort({}, errors)).toEqual({ start: 1, code: 1 });
        expect(buildPagination({}, errors)).toEqual({ page: 1, limit: 20, skip: 0 });
        expect(errors).toEqual([]);
    });
 
    test('builds range filters for dates and prices', () => {
        const errors = [];
        const f = buildFilter({ startFrom: '2021-03-01', startTo: '2021-12-31', minPrice: '500', maxPrice: '1500' }, errors);
        expect(errors).toEqual([]);
        expect(f.start.$gte).toEqual(new Date('2021-03-01'));
        expect(f.start.$lte).toEqual(new Date('2021-12-31'));
        expect(f.perPerson).toEqual(expect.objectContaining({ $gte: 500, $lte: 1500 }));
    });
 
    test('resort filter is an anchored, escaped, case-insensitive regex', () => {
        const f = buildFilter({ resort: 'emerald (bay)' }, []);
        expect(f.resort.$regex).toBe('^emerald \\(bay\\)');
        expect(f.resort.$options).toBe('i');
    });
 
    test('regex metacharacters are escaped (no ReDoS / pattern injection)', () => {
        expect(escapeRegex('.*+?^${}()|[]\\')).toBe('\\.\\*\\+\\?\\^\\$\\{\\}\\(\\)\\|\\[\\]\\\\');
    });
 
    test('object-valued parameters (operator injection attempts) are ignored', () => {
        const errors = [];
        const f = buildFilter({ resort: { $ne: null }, minPrice: { $gt: '' } }, errors);
        expect(f).toEqual({});
    });
 
    test('invalid values are reported instead of silently queried', () => {
        const errors = [];
        buildFilter({ startFrom: 'not-a-date', minPrice: '-5', maxPrice: 'abc' }, errors);
        buildFilter({ minPrice: '900', maxPrice: '100' }, errors);
        buildSort({ sort: 'password' }, errors);
        buildPagination({ page: '0', limit: '2.5' }, errors);
        expect(errors).toHaveLength(7);
    });
 
    test('sort whitelist maps client names to fields and supports descending', () => {
        expect(buildSort({ sort: '-price' }, [])).toEqual({ perPerson: -1, code: 1 });
        expect(buildSort({ sort: 'code' }, [])).toEqual({ code: 1 });
    });
 
    test('limit is capped and skip is computed from page', () => {
        expect(buildPagination({ page: '3', limit: '10' }, [])).toEqual({ page: 3, limit: 10, skip: 20 });
        expect(buildPagination({ limit: '100000' }, []).limit).toBe(MAX_LIMIT);
    });
});