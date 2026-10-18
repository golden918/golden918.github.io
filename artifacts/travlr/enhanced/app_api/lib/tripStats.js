/**
 * NEW FILE 
 * - seperate from controller so the pipeline definitions can be unit tested
 * on their own as well as end-to-end against MongoDB (tests/trips.api.test.js).
 * 
 * byResort: one row per resort - trip count, average/min/max price per person,
 *           and the earliest/latest departure, most expensive resort first.
 * overall:  the same price summary across every matching trip.
 *
 * $match runs first so the filter can use the { resort, start } / { start } /
 * { perPerson } indexes before any documents are grouped.
 */
const round2 = (expr) => ({ $round: [expr, 2] });
 
function buildStatsPipelines(filter = {}) {
    const byResortPipeline = [
        { $match: filter },
        {
            $group: {
                _id: '$resort',
                tripCount: { $sum: 1 },
                avgPrice: { $avg: '$perPerson' },
                minPrice: { $min: '$perPerson' },
                maxPrice: { $max: '$perPerson' },
                nextStart: { $min: '$start' },
                lastStart: { $max: '$start' }
            }
        },
        {
            $project: {
                _id: 0,
                resort: '$_id',
                tripCount: 1,
                avgPrice: round2('$avgPrice'),
                minPrice: 1,
                maxPrice: 1,
                nextStart: 1,
                lastStart: 1
            }
        },
        { $sort: { avgPrice: -1, resort: 1 } }
    ];
 
    const overallPipeline = [
        { $match: filter },
        {
            $group: {
                _id: null,
                tripCount: { $sum: 1 },
                avgPrice: { $avg: '$perPerson' },
                minPrice: { $min: '$perPerson' },
                maxPrice: { $max: '$perPerson' }
            }
        },
        {
            $project: {
                _id: 0,
                tripCount: 1,
                avgPrice: round2('$avgPrice'),
                minPrice: 1,
                maxPrice: 1
            }
        }
    ];
 
    return { byResortPipeline, overallPipeline };
}
 
module.exports = { buildStatsPipelines };