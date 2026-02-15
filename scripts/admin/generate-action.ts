const [, , key = 'actionKey'] = process.argv;

console.log(`defineAction({
\tkey: '${key}',
\tnameKey: 'admin.resources.<resource>.actions.${key}',
\tshowOnIndex: true,
\tshowOnDetail: true
})`);
