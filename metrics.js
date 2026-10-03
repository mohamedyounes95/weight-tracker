// Metric definitions shared by the parser, form, charts and Excel import/export.
// `header` must stay identical to the original Excel columns so exports round-trip.
(function (root) {
  const METRICS = [
    { key: 'weight',         label: 'Weight',               header: 'Weight (kg)',               unit: 'kg',   min: 30,  max: 250,  step: 0.05, aliases: ['weight', 'body weight'] },
    { key: 'bmi',            label: 'BMI',                  header: 'BMI',                       unit: '',     min: 10,  max: 60,   step: 0.1,  aliases: ['bmi'] },
    { key: 'bodyFatPct',     label: 'Body fat',             header: 'Body Fat (%)',              unit: '%',    min: 3,   max: 60,   step: 0.1,  aliases: ['body fat', 'body fat rate', 'body fat percentage', 'bodyfat', 'fat rate'] },
    { key: 'heartRate',      label: 'Heart rate',           header: 'Heart Rate (bpm)',          unit: 'bpm',  min: 35,  max: 200,  step: 1,    aliases: ['heart rate', 'heartrate'] },
    { key: 'muscleMass',     label: 'Muscle mass',          header: 'Muscle Mass (kg)',          unit: 'kg',   min: 20,  max: 120,  step: 0.1,  aliases: ['muscle mass', 'muscle'] },
    { key: 'bmr',            label: 'BMR',                  header: 'BMR (kcal)',                unit: 'kcal', min: 800, max: 3500, step: 1,    aliases: ['bmr', 'basal metabolic rate', 'basal metabolism'] },
    { key: 'bodyFatMass',    label: 'Body fat mass',        header: 'Body Fat Mass (kg)',        unit: 'kg',   min: 2,   max: 120,  step: 0.1,  aliases: ['body fat mass', 'fat mass'] },
    { key: 'waterPct',       label: 'Water',                header: 'Water (%)',                 unit: '%',    min: 30,  max: 80,   step: 0.1,  aliases: ['water', 'body water', 'water rate', 'water percentage'] },
    { key: 'leanMass',       label: 'Lean body mass',       header: 'Lean Body Mass (kg)',       unit: 'kg',   min: 25,  max: 150,  step: 0.1,  aliases: ['lean body mass', 'fat-free body weight', 'fat free body weight', 'fat-free mass', 'fat free mass', 'lean mass'] },
    { key: 'boneMass',       label: 'Bone mass',            header: 'Bone Mass (kg)',            unit: 'kg',   min: 1,   max: 8,    step: 0.1,  aliases: ['bone mass', 'bone'] },
    { key: 'visceralFat',    label: 'Visceral fat',         header: 'Visceral Fat',              unit: '',     min: 1,   max: 60,   step: 1,    aliases: ['visceral fat', 'visceral fat index', 'visceral fat level', 'visceral'] },
    { key: 'proteinPct',     label: 'Protein',              header: 'Protein (%)',               unit: '%',    min: 5,   max: 30,   step: 0.1,  aliases: ['protein', 'protein rate'] },
    { key: 'skeletalMuscle', label: 'Skeletal muscle mass', header: 'Skeletal Muscle Mass (kg)', unit: 'kg',   min: 10,  max: 80,   step: 0.1,  aliases: ['skeletal muscle mass', 'skeletal muscle', 'skeletal muscle rate'] },
    { key: 'subcutFatPct',   label: 'Subcutaneous fat',     header: 'Subcutaneous Fat (%)',      unit: '%',    min: 2,   max: 60,   step: 0.1,  aliases: ['subcutaneous fat', 'subcutaneous fat rate', 'subcutaneous'] },
    { key: 'bodyAge',        label: 'Body age',             header: 'Body Age',                  unit: 'yrs',  min: 10,  max: 100,  step: 1,    aliases: ['body age', 'metabolic age'] },
    { key: 'bodyType',       label: 'Body type',            header: 'Body Type',                 unit: '',     text: true,              aliases: ['body type'] },
  ];
  const BODY_TYPES = ['Hidden Obesity', 'Lack of Exercise', 'Standard Muscular', 'Lean Muscular', 'Over Fat',
    'Overweight', 'Muscular', 'Standard', 'Average', 'Obese', 'Skinny', 'Thin', 'Lean', 'Solid', 'Athletic', 'Fat'];
  const byKey = Object.fromEntries(METRICS.map(m => [m.key, m]));
  const api = { METRICS, BODY_TYPES, byKey };
  if (typeof module !== 'undefined' && module.exports) module.exports = api;
  else root.Metrics = api;
})(typeof window !== 'undefined' ? window : globalThis);
