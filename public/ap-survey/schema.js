export const categories = ['', 'art and craft room', 'basketball court', 'canteen', 'CCA Room', 'Circulation Space', 'Classrooms', 'Computer Room', 'Cookery Room', 'Councelling Room', 'Dance Studio', 'D&T workshop', 'E-Exam Venue', 'General Office', 'Gym', 'HOD office', 'ICT Support Rm', 'ISH', 'LEARNING AND BEHAVIOR SUPPORT RM', 'MEDIA RESOURCE LIB', 'Mother tongue language room', 'multi-purpose hall', 'nursing room', 'outdoor learning area', 'parade square', 'staff lounge', 'staff meeting room', 'staff room', 'study area', 'subject based banding room'];
export const lanRooms = Array.from({ length: 8 }, (_, i) => `Lan Room ${i + 1}`).concat('Server Room');
export const fields = ['building', 'floor', 'room', 'category', 'network', 'model', 'hostname', 'serial', 'mac', 'lanRoom', 'relocation', 'reason'];
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
  if (entry.network !== 'MOE-Owned') return 'Invalid network type.';
  if (!['Yes', 'No'].includes(entry.relocation)) return 'Choose whether relocation is required.';
  if (entry.mac && !/^[a-f\d]{12}$/i.test(entry.mac.replace(/[:.\-]/g, ''))) return 'Enter a valid MAC address or leave it blank.';
  if (entry.relocation === 'Yes' && !entry.reason.trim()) return 'Enter a relocation reason.';
  return '';
}
