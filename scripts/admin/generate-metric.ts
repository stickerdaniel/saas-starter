const [, , key = 'total', type = 'value'] = process.argv;

console.log(`defineMetric({
\tkey: '${key}',
\ttype: '${type}',
\tlabelKey: 'admin.resources.<resource>.metrics.${key}'
})`);
