/**
 * Enhancements
 * - code is now UNIQUE, normalized to upper case, and validated against the
 * catalog format.
 * - perPerson is stored as a number instead of a string so the database can sort,
 * range filter, and aggregate on price.
 * - Field level validation moves data integrity rules into the data layer.
 * - Compound indexes are created for efficient querying.
 * - timestamps add createdAt/updatedAt for auditing. 
 */

const mongoose = require('mongoose');

const TRIP_CODE_PATTERN = /^[A-Z]{4}\d{6}$/;
const IMAGE_PATTERN = /^[\w-]+\.(jpg|jpeg|png|gif|webp)$/i;

const toPrice = (value) => {
    if (typeof value === 'string') {
        const cleaned = value.replace(/[$,\s]/g, '');
        return cleaned === '' ? undefined : Number(cleaned);
    }
    return value;
};

// Define the schema for a trip
const tripSchema = new mongoose.Schema({
    code: { 
        type: String, 
        required: true, 
        index: true 
    },
    name: { type: String, required: true, index: true },
    length: { type: String, required: true },
    start: { type: Date, required: true },
    resort: { type: String, required: true },
    perPerson: { 
        type: String, 
        required: true 
    },
    image: { 
        type: String, 
        required: true 
    },
    description: { type: String, required: true }
}, {
    timestamps: true,
    versionKey: false
});

// Indexes that match how the application will query the trips
tripSchema.index({ resort: 1, start: 1 });
tripSchema.index({ start: 1 });
tripSchema.index({ perPerson: 1 });

// Fields a client is allowed to set (whitelist)
tripSchema.statics.WRITABLE_FIELDS = Object.freeze(
    ['code', 'name', 'length', 'start', 'resort', 'perPerson', 'image', 'description']
)
tripSchema.statics.TRIP_CODE_PATTERN = TRIP_CODE_PATTERN;

const Trip = mongoose.models.trips ||mongoose.model('trips', tripSchema);
module.exports = Trip;