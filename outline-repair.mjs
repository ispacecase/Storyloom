/** Validate the complete response before writing, and request one corrected response if needed. */
export async function repairOutline(initial, validate, repair) {
 try {validate(initial);return initial;} catch(error) {
  const result=await repair(initial,error.message);
  validate(result);
  return result;
 }
}
