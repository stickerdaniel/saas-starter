const [, , key = 'status'] = process.argv;

console.log(`defineFilter({
\tkey: '${key}',
\tlabelKey: 'admin.resources.<resource>.filters.${key}',
\ttype: 'select',
\turlKey: '${key}',
\tdefaultValue: 'all',
\toptions: [
\t\t{ value: 'all', labelKey: 'admin.resources.filters.all' }
\t]
})`);
