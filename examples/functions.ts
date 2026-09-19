function add(a: number, b: number): number {
  return a + b;
}
const total: number = add(10, 20);
if (total >= 30) {
  console.log('total', total);
} else {
  console.log(null);
}
