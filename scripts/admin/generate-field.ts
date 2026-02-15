const [, , attribute = 'name', type = 'text'] = process.argv;

console.log(`defineField({
\ttype: '${type}',
\tattribute: '${attribute}',
\tlabelKey: 'admin.resources.<resource>.fields.${attribute}',
\tshowOnIndex: true,
\tshowOnDetail: true,
\tshowOnForm: true
})`);
