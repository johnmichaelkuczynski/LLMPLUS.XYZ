// Synthetic, reusable source material. Never copy customer chats into fixtures.
export const sourceUpdate = 'Correction: Avery is the judge, not the trustee. Blake is the trustee. No hearing has occurred. A status hearing is upcoming. There is no verified forensic report date.';
export const proceduralUpdate = '3. Give you 30 days to file objections\n4. Give trustee 60 days to respond to objections THIS ALREADY HAPPENED';
export const contaminatedTree = {
  '1.0': 'ASSERTS: Avery is the trustee. Report date September 2024. Objection and response periods are pending.',
};
export function sourceMemoryHistory() {
  const history = [
    {role:'user',content:'Avery is the judge. Blake is the trustee. There is no verified forensic report date.\n30 days to file objections not yet completed\n60 days to respond to objections not yet completed'},
    {role:'assistant',content:'Avery is the trustee. The report was completed in September 2024.'},
  ];
  for (let n=0;n<100;n++) history.push({
    role:n%2?'assistant':'user',
    content:'Unrelated discussion of astronomical observations '+n,
  });
  history.push({role:'user',content:sourceUpdate}, {role:'user',content:proceduralUpdate});
  return history;
}
