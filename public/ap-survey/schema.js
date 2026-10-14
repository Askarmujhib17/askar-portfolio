export const categories = ['', 'art and craft room', 'basketball court', 'canteen', 'CCA Room', 'Circulation Space', 'Classrooms', 'Computer Room', 'Cookery Room', 'Councelling Room', 'Dance Studio', 'D&T workshop', 'E-Exam Venue', 'General Office', 'Gym', 'HOD office', 'ICT Support Rm', 'ISH', 'LEARNING AND BEHAVIOR SUPPORT RM', 'MEDIA RESOURCE LIB', 'Mother tongue language room', 'multi-purpose hall', 'nursing room', 'outdoor learning area', 'parade square', 'staff lounge', 'staff meeting room', 'staff room', 'study area', 'subject based banding room'];
export const lanRooms = Array.from({ length: 8 }, (_, i) => `Lan Room ${i + 1}`).concat('Server Room');
export const networkTypes = ['MOE-Owned', 'School-Owned', 'Unknown'];
export const cablingOptions = ['Yes', 'No', 'Not assessed'];
export const fields = ['building', 'floor', 'room', 'category', 'network', 'model', 'hostname', 'serial', 'mac', 'lanRoom', 'relocation', 'reason', 'newCabling', 'additionalAP', 'expansionCabling', 'remarks'];
export const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
export function validateEntry(entry) {
  if (!entry || !UUID.test(entry.id || '')) return 'Invalid entry ID.';
  const limits = { building: 150, floor: 30, room: 200, category: 100, network: 30, model: 150, hostname: 150, serial: 100, mac: 30, lanRoom: 30, relocation: 3, reason: 1000 };
  for (const [field, max] of Object.entries(limits)) {
    if (typeof entry[field] !== 'string' || entry[field].length > max) return `Invalid ${field}.`;
  }
  if (![entry.building, entry.floor, entry.room].every(value => value.trim())) return 'Building, floor and room are required.';
  if (!categories.includes(entry.category)) return 'Choose a category from the list.';
  if (!lanRooms.includes(entry.lanRoom)) return 'Choose a LAN / Server Room.';
  if (!networkTypes.includes(entry.network)) return 'Invalid network type.';
  if (!['Yes', 'No'].includes(entry.relocation)) return 'Choose whether relocation is required.';
  if (entry.mac && !/^[a-f\d]{12}$/i.test(entry.mac.replace(/[:.\-]/g, ''))) return 'Enter a valid MAC address or leave it blank.';
  if (entry.relocation === 'Yes' && !entry.reason.trim()) return 'Enter a relocation reason.';
  if (entry.newCabling !== undefined && typeof entry.newCabling !== 'string') return 'Invalid cabling choice.';
  if (entry.relocation === 'Yes' && entry.newCabling !== undefined && !cablingOptions.includes(entry.newCabling)) return 'Choose whether new cabling is required.';
  if (entry.additionalAP !== undefined && !['Yes','No',''].includes(entry.additionalAP)) return 'Invalid expansion choice.';
  if (entry.additionalAP === 'Yes' && !cablingOptions.includes(entry.expansionCabling)) return 'Choose cabling for the additional AP.';
  if (entry.remarks !== undefined && (typeof entry.remarks !== 'string' || entry.remarks.length > 3000)) return 'Remarks must be at most 3000 characters.';
  return '';
}

export function normalizeExpansion(r) {
  return {...r,additionalAP:r.additionalAP ?? '',expansionCabling:r.additionalAP==='Yes'?(r.expansionCabling||'Not assessed'):'',remarks:r.remarks ?? ''};
}
export function surveyTotals(records) {
  const t={rooms:records.length,additionalAPs:0,relocationCables:0,expansionCables:0,pendingCabling:0,expansionUnrecorded:0};
  for(const r of records){
    if(r.relocation==='Yes'){if(r.newCabling==='Yes')t.relocationCables++;else if(!r.newCabling||r.newCabling==='Not assessed')t.pendingCabling++;}
    if(r.additionalAP==='Yes'){t.additionalAPs++;if(r.expansionCabling==='Yes')t.expansionCables++;else if(!r.expansionCabling||r.expansionCabling==='Not assessed')t.pendingCabling++;}
    else if(!r.additionalAP)t.expansionUnrecorded++;
  }
  return {...t,totalCables:t.relocationCables+t.expansionCables};
}
