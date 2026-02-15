const [, , key = 'default'] = process.argv;

console.log(`defineLens({
\tkey: '${key}',
\tnameKey: 'admin.resources.<resource>.lenses.${key}'
})`);
