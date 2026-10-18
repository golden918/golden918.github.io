/**
 * Unit tests for the /trips/stats aggregation pipelines, executed with mingo so the
 * pipeline logic is checked without a database. The same pipelines are run
 * against real MongoDB in trips.api.test.js.
 */
require('mingo/init/system');
const { Aggregator } = require('mingo');
const { buildStatsPipelines } = require('../app_api/lib/tripStats');
const { buildFilter } = require('../app_api/lib/tripQuery');
 
const docs = [
    { code: 'GALR210214', resort: 'Emerald Bay, 3 stars', perPerson: 799, start: new Date('2021-02-14T08:00:00Z') },
    { code: 'DAWR210315', resort: 'Blue Lagoon, 4 stars', perPerson: 1199, start: new Date('2021-03-15T08:00:00Z') },
    { code: 'CLAR210621', resort: 'Coral Sands, 5 stars', perPerson: 1999, start: new Date('2021-06-21T08:00:00Z') },
    { code: 'EMBK210901', resort: 'Emerald Bay, 3 stars', perPerson: 601.555, start: new Date('2021-09-01T08:00:00Z') }
];
const run = (pipeline) => new Aggregator(pipeline).run(docs);
 
describe('trip stats aggregation pipelines', () => {
    test('$match is the first stage so indexes can be used', () => {
        const { byResortPipeline, overallPipeline } = buildStatsPipelines({});
        expect(Object.keys(byResortPipeline[0])).toEqual(['$match']);
        expect(Object.keys(overallPipeline[0])).toEqual(['$match']);
    });
 
    test('byResort groups, rounds the average to cents and sorts by average desc', () => {
        const rows = run(buildStatsPipelines({}).byResortPipeline);
        expect(rows.map(r => r.resort)).toEqual(['Coral Sands, 5 stars', 'Blue Lagoon, 4 stars', 'Emerald Bay, 3 stars']);
        const emerald = rows[2];
        expect(emerald).toEqual({
            resort: 'Emerald Bay, 3 stars', tripCount: 2,
            avgPrice: 700.28, minPrice: 601.555, maxPrice: 799,
            nextStart: new Date('2021-02-14T08:00:00Z'), lastStart: new Date('2021-09-01T08:00:00Z')
        });
        expect(emerald).not.toHaveProperty('_id');
    });
 
    test('overall summarizes every matching trip', () => {
        const [overall] = run(buildStatsPipelines({}).overallPipeline);
        expect(overall).toEqual({ tripCount: 4, avgPrice: 1149.64, minPrice: 601.555, maxPrice: 1999 });
    });
 
    test('filters from the list endpoint narrow the report', () => {
        const filter = buildFilter({ resort: 'emerald', startFrom: '2021-03-01' }, []);
        const rows = run(buildStatsPipelines(filter).byResortPipeline);
        expect(rows).toHaveLength(1);
        expect(rows[0]).toMatchObject({ tripCount: 1, minPrice: 601.555 });
    });
});
 