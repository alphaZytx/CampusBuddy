/**
 * Demo dataset.
 *
 * Entirely fictional: invented names, invented UPI handles, invented listings.
 * No real student's personal information appears anywhere in this repository
 * (spec §90).
 */

export interface SeedStudent {
  name: string;
  handle: string;
  department: string;
  year: number;
  hostel: string;
  skills: string[];
  categories: string[];
  bio?: string;
}

export const STUDENTS: readonly SeedStudent[] = [
  { name: 'Aman Singh', handle: 'aman.ug22.cs', department: 'CSE', year: 3, hostel: 'Hostel A', skills: ['DBMS', 'SQL', 'Python'], categories: ['quick-delivery', 'academic-help'], bio: 'Happy to help with SQL and DBMS. Usually near the canteen in the evening.' },
  { name: 'Rahul Kumar', handle: 'rahul.ug22.cs', department: 'CSE', year: 3, hostel: 'Hostel A', skills: ['C++', 'Data Structures'], categories: ['academic-help', 'technical-help'] },
  { name: 'Priya Sharma', handle: 'priya.ug23.ec', department: 'ECE', year: 2, hostel: 'Girls Hostel 1', skills: ['Signals', 'MATLAB'], categories: ['academic-help'], bio: 'Second year ECE. I keep a spare calculator if anyone needs one.' },
  { name: 'Karan Verma', handle: 'karan.ug21.me', department: 'ME', year: 4, hostel: 'Hostel B', skills: ['CAD', 'SolidWorks'], categories: ['campus-assistance', 'borrow-rent'] },
  { name: 'Sneha Gupta', handle: 'sneha.ug22.ee', department: 'EE', year: 3, hostel: 'Girls Hostel 1', skills: ['Circuits', 'Arduino'], categories: ['technical-help', 'academic-help'] },
  { name: 'Rohit Yadav', handle: 'rohit.ug23.ce', department: 'CE', year: 2, hostel: 'Hostel C', skills: ['AutoCAD'], categories: ['quick-delivery', 'campus-assistance'], bio: 'Fast on a cycle. Canteen runs are my speciality.' },
  { name: 'Ananya Mishra', handle: 'ananya.ug21.cs', department: 'CSE', year: 4, hostel: 'Girls Hostel 2', skills: ['Machine Learning', 'Python', 'Interview Prep'], categories: ['academic-help'], bio: 'Placed already — happy to help juniors with interview preparation.' },
  { name: 'Vikram Rao', handle: 'vikram.ug22.me', department: 'ME', year: 3, hostel: 'Hostel B', skills: ['Thermodynamics'], categories: ['academic-help', 'borrow-rent'] },
  { name: 'Nisha Patel', handle: 'nisha.ug23.che', department: 'CHE', year: 2, hostel: 'Girls Hostel 1', skills: ['Chemistry'], categories: ['quick-delivery'] },
  { name: 'Arjun Nair', handle: 'arjun.ug21.ec', department: 'ECE', year: 4, hostel: 'Hostel A', skills: ['Embedded C', 'PCB Design'], categories: ['technical-help'] },
  { name: 'Divya Ranjan', handle: 'divya.ug22.ce', department: 'CE', year: 3, hostel: 'Girls Hostel 2', skills: ['Surveying'], categories: ['campus-assistance'] },
  { name: 'Sahil Khan', handle: 'sahil.ug23.cs', department: 'CSE', year: 2, hostel: 'Hostel C', skills: ['Web Development', 'React'], categories: ['technical-help', 'quick-delivery'] },
  { name: 'Meera Joshi', handle: 'meera.ug22.arch', department: 'ARCH', year: 3, hostel: 'Girls Hostel 2', skills: ['Sketching', 'Photoshop'], categories: ['borrow-rent', 'marketplace'], bio: 'I rent out my camera and tripod between studio submissions.' },
  { name: 'Ravi Shankar', handle: 'ravi.ug21.ee', department: 'EE', year: 4, hostel: 'Hostel B', skills: ['Power Systems'], categories: ['academic-help'] },
  { name: 'Pooja Kumari', handle: 'pooja.ug23.ec', department: 'ECE', year: 2, hostel: 'Girls Hostel 1', skills: ['Communication Systems'], categories: ['quick-delivery', 'academic-help'] },
  { name: 'Deepak Anand', handle: 'deepak.ug22.me', department: 'ME', year: 3, hostel: 'Hostel A', skills: ['Workshop'], categories: ['campus-assistance', 'borrow-rent'] },
  { name: 'Shreya Das', handle: 'shreya.ug21.cs', department: 'CSE', year: 4, hostel: 'Girls Hostel 2', skills: ['Competitive Programming', 'Algorithms'], categories: ['academic-help'], bio: 'ICPC regionalist. I take small tutoring sessions on algorithms.' },
  { name: 'Manish Tiwari', handle: 'manish.ug23.ce', department: 'CE', year: 2, hostel: 'Hostel C', skills: ['Concrete Technology'], categories: ['quick-delivery'] },
  { name: 'Kavya Reddy', handle: 'kavya.ug22.che', department: 'CHE', year: 3, hostel: 'Girls Hostel 1', skills: ['Process Design'], categories: ['academic-help', 'marketplace'] },
  { name: 'Nitin Chauhan', handle: 'nitin.ug21.me', department: 'ME', year: 4, hostel: 'Hostel B', skills: ['Automobile'], categories: ['borrow-rent'] },
  { name: 'Ishita Bose', handle: 'ishita.ug23.cs', department: 'CSE', year: 2, hostel: 'Girls Hostel 2', skills: ['Java', 'DBMS'], categories: ['academic-help', 'technical-help'] },
  { name: 'Gaurav Pandey', handle: 'gaurav.ug22.ec', department: 'ECE', year: 3, hostel: 'Hostel A', skills: ['VLSI'], categories: ['campus-assistance'] },
  { name: 'Riya Agarwal', handle: 'riya.ug21.arch', department: 'ARCH', year: 4, hostel: 'Girls Hostel 1', skills: ['3D Modelling'], categories: ['marketplace', 'borrow-rent'] },
  { name: 'Suraj Prasad', handle: 'suraj.ug23.ee', department: 'EE', year: 2, hostel: 'Hostel C', skills: ['Basic Electronics'], categories: ['quick-delivery', 'campus-assistance'] },
];

export const STAFF = [
  { name: 'Campus Administrator', handle: 'admin', role: 'CAMPUS_ADMIN' as const },
  { name: 'Student Moderator', handle: 'moderator', role: 'MODERATOR' as const },
];

/** Locations around a campus, expressed as small offsets from the configured centre. */
export const PLACES: ReadonlyArray<{ label: string; dLat: number; dLng: number }> = [
  { label: 'Campus Canteen', dLat: 0.0006, dLng: 0.0004 },
  { label: 'Main Gate', dLat: -0.0012, dLng: -0.0008 },
  { label: 'Central Library', dLat: 0.0003, dLng: -0.0006 },
  { label: 'Hostel A', dLat: 0.0009, dLng: 0.0011 },
  { label: 'Hostel B', dLat: 0.0011, dLng: 0.0014 },
  { label: 'Hostel C', dLat: 0.0013, dLng: 0.0009 },
  { label: 'Girls Hostel 1', dLat: -0.0007, dLng: 0.0012 },
  { label: 'Academic Block', dLat: 0.0001, dLng: 0.0002 },
  { label: 'Sports Complex', dLat: -0.0015, dLng: 0.0006 },
  { label: 'Print Shop', dLat: 0.0004, dLng: 0.0009 },
];

export interface SeedRequest {
  title: string;
  description: string;
  category: string;
  subcategory?: string;
  rewardRupees: number;
  productCostRupees?: number;
  pickup?: string;
  delivery?: string;
  urgency?: 'NORMAL' | 'URGENT';
  /** Where in the lifecycle this seeded request should end up. */
  outcome: 'OPEN' | 'OFFERS' | 'IN_PROGRESS' | 'COMPLETED' | 'RATED' | 'EXPIRED';
  deadlineMinutes?: number;
  maxRewardRupees?: number;
  autoEscalate?: boolean;
}

export const REQUESTS: readonly SeedRequest[] = [
  { title: 'Bring Cold Drink', description: 'A chilled cold drink from the campus canteen, please. I am stuck finishing a lab report.', category: 'quick-delivery', subcategory: 'Cold Drinks', rewardRupees: 10, productCostRupees: 20, pickup: 'Campus Canteen', delivery: 'Hostel A', outcome: 'OPEN', deadlineMinutes: 25 },
  { title: 'Need Maggie from the night shop', description: 'Two packets of Maggie, anything spicy. Late night hunger.', category: 'quick-delivery', subcategory: 'Snacks', rewardRupees: 30, productCostRupees: 40, pickup: 'Main Gate', delivery: 'Hostel B', outcome: 'OPEN', deadlineMinutes: 45, maxRewardRupees: 60, autoEscalate: true },
  { title: 'Get a printout of my resume', description: '2 copies, colour, A4. I will send the PDF on chat.', category: 'quick-delivery', subcategory: 'Printouts', rewardRupees: 20, productCostRupees: 30, pickup: 'Print Shop', delivery: 'Academic Block', outcome: 'OFFERS', deadlineMinutes: 90 },
  { title: 'Need DBMS notes for Unit 3 and 4', description: 'Handwritten or typed, either is fine. Exam is tomorrow morning.', category: 'academic-help', subcategory: 'Notes', rewardRupees: 50, outcome: 'OFFERS', deadlineMinutes: 600, urgency: 'URGENT' },
  { title: 'Help me understand SQL JOINs', description: 'About 30 minutes. I keep mixing up LEFT and INNER joins.', category: 'academic-help', subcategory: 'Peer Tutoring', rewardRupees: 100, outcome: 'IN_PROGRESS', deadlineMinutes: 240 },
  { title: 'Borrow a scientific calculator for 3 hours', description: 'Mine stopped working right before the maths test.', category: 'borrow-rent', subcategory: 'Scientific Calculator', rewardRupees: 40, outcome: 'OPEN', deadlineMinutes: 180, urgency: 'URGENT' },
  { title: 'Collect my parcel from the main gate', description: 'A small courier is waiting at the gate. I am in a lab until 5.', category: 'campus-assistance', subcategory: 'Collection', rewardRupees: 35, pickup: 'Main Gate', delivery: 'Hostel C', outcome: 'RATED', deadlineMinutes: 120 },
  { title: 'Previous year questions for Signals and Systems', description: 'Any PYQs from the last three years would help a lot.', category: 'academic-help', subcategory: 'Previous Year Questions', rewardRupees: 60, outcome: 'RATED', deadlineMinutes: 720 },
  { title: 'Bring chocolates from the shop outside', description: 'Two Dairy Milk Silk. It is my friend’s birthday.', category: 'quick-delivery', subcategory: 'Chocolates', rewardRupees: 15, productCostRupees: 90, pickup: 'Main Gate', delivery: 'Girls Hostel 1', outcome: 'RATED', deadlineMinutes: 60 },
  { title: 'Laptop will not connect to the hostel wifi', description: 'Windows 11. It connects but shows no internet. Anyone good with networks?', category: 'technical-help', subcategory: 'Computer Troubleshooting', rewardRupees: 80, outcome: 'COMPLETED', deadlineMinutes: 300 },
  { title: 'Stand in the fee counter queue for me', description: 'I have a class until 12. The queue is usually long.', category: 'campus-assistance', subcategory: 'Queue Assistance', rewardRupees: 50, pickup: 'Academic Block', outcome: 'EXPIRED', deadlineMinutes: 30 },
  { title: 'Placement preparation material for CSE', description: 'Aptitude and DSA sheets that actually helped you.', category: 'academic-help', subcategory: 'Placement Material', rewardRupees: 120, outcome: 'OFFERS', deadlineMinutes: 1440 },
  { title: 'Need a pen urgently in the exam hall block', description: 'Blue ballpoint. I will pay on the spot.', category: 'quick-delivery', subcategory: 'Stationery', rewardRupees: 20, productCostRupees: 10, delivery: 'Academic Block', outcome: 'OPEN', deadlineMinutes: 15, urgency: 'URGENT' },
  { title: 'Carry my bags to the hostel', description: 'Coming back from home with two heavy bags.', category: 'campus-assistance', subcategory: 'Carrying / Moving', rewardRupees: 60, pickup: 'Main Gate', delivery: 'Hostel B', outcome: 'OPEN', deadlineMinutes: 120 },
  { title: 'Set up my development environment', description: 'Need Node, Git and VS Code configured properly on a fresh laptop.', category: 'technical-help', subcategory: 'Software Setup', rewardRupees: 150, outcome: 'OPEN', deadlineMinutes: 2880 },
];

export interface SeedListing {
  title: string;
  description: string;
  type: 'SELL' | 'RENT' | 'EXCHANGE' | 'GIVEAWAY';
  priceRupees: number;
  condition: 'NEW' | 'LIKE_NEW' | 'GOOD' | 'FAIR' | 'POOR';
  zone: string;
}

export const LISTINGS: readonly SeedListing[] = [
  { title: 'Engineering Mathematics — B.S. Grewal', description: 'Second semester textbook, all pages intact, a few pencil marks.', type: 'SELL', priceRupees: 250, condition: 'GOOD', zone: 'Hostel A' },
  { title: 'Lab coat (size M)', description: 'Used for one semester of chemistry lab. Washed and clean.', type: 'SELL', priceRupees: 200, condition: 'LIKE_NEW', zone: 'Girls Hostel 1' },
  { title: 'Study table lamp', description: 'Warm white LED, adjustable neck. Leaving the hostel so selling.', type: 'SELL', priceRupees: 350, condition: 'GOOD', zone: 'Hostel B' },
  { title: 'Old drafting sheets and instruments', description: 'First year engineering drawing kit. Free to whoever needs it.', type: 'GIVEAWAY', priceRupees: 0, condition: 'FAIR', zone: 'Hostel C' },
  { title: 'Badminton racket', description: 'Yonex, restrung last month. Selling as I am graduating.', type: 'SELL', priceRupees: 800, condition: 'GOOD', zone: 'Sports Complex' },
  { title: 'Data Structures book — exchange for DBMS book', description: 'Happy to swap with anyone who has a Korth DBMS copy.', type: 'EXCHANGE', priceRupees: 0, condition: 'GOOD', zone: 'Central Library' },
  { title: 'Bucket and mug set', description: 'Hostel essentials, barely used. Graduating this semester.', type: 'SELL', priceRupees: 120, condition: 'LIKE_NEW', zone: 'Hostel A' },
  { title: 'Casio scientific calculator', description: 'FX-991ES Plus. Upgraded to a newer model so selling this one.', type: 'SELL', priceRupees: 600, condition: 'GOOD', zone: 'Hostel B' },
];

export interface SeedRentalItem {
  name: string;
  description: string;
  category: string;
  condition: 'NEW' | 'LIKE_NEW' | 'GOOD' | 'FAIR' | 'POOR';
  priceRupees: number;
  unit: 'HOUR' | 'DAY' | 'WEEK';
  depositRupees: number;
  zone: string;
  rules?: string;
}

export const RENTAL_ITEMS: readonly SeedRentalItem[] = [
  { name: 'Scientific Calculator', description: 'Casio FX-991EX. Perfect for exams that allow it.', category: 'borrow-rent', condition: 'GOOD', priceRupees: 30, unit: 'DAY', depositRupees: 200, zone: 'Hostel A', rules: 'Please return before 9 PM on the due date.' },
  { name: 'DSLR Camera (Canon 200D)', description: 'With an 18-55mm kit lens. Great for fest photography.', category: 'borrow-rent', condition: 'LIKE_NEW', priceRupees: 300, unit: 'DAY', depositRupees: 3000, zone: 'Girls Hostel 2', rules: 'Handle carefully. Any damage is deducted from the deposit.' },
  { name: 'Camera Tripod', description: 'Lightweight aluminium tripod, extends to about 5 feet.', category: 'borrow-rent', condition: 'GOOD', priceRupees: 50, unit: 'DAY', depositRupees: 500, zone: 'Girls Hostel 2' },
  { name: 'Laptop Charger (Dell 65W)', description: 'Type-C. Useful if yours has stopped working mid-submission.', category: 'borrow-rent', condition: 'GOOD', priceRupees: 20, unit: 'DAY', depositRupees: 500, zone: 'Hostel C' },
  { name: '20000mAh Power Bank', description: 'Fast charging, two USB ports. Good for a fest or a long trip.', category: 'borrow-rent', condition: 'GOOD', priceRupees: 25, unit: 'DAY', depositRupees: 400, zone: 'Hostel B' },
  { name: 'HDMI Cable (2m)', description: 'For presentations in the seminar hall.', category: 'borrow-rent', condition: 'GOOD', priceRupees: 10, unit: 'DAY', depositRupees: 100, zone: 'Academic Block' },
  { name: 'Bluetooth Speaker', description: 'JBL Go 3. Loud enough for a hostel room gathering.', category: 'borrow-rent', condition: 'LIKE_NEW', priceRupees: 60, unit: 'DAY', depositRupees: 800, zone: 'Hostel A' },
  { name: 'Cricket Kit', description: 'Bat, pads and gloves. Ask a day in advance on weekends.', category: 'borrow-rent', condition: 'FAIR', priceRupees: 80, unit: 'DAY', depositRupees: 1000, zone: 'Sports Complex' },
];

export const REVIEWS = {
  helper: [
    'Delivered in under ten minutes. Very reliable.',
    'Really helpful and polite. Would ask again.',
    'Got exactly what I asked for and kept me updated on chat.',
    'Quick and no fuss. Thanks!',
    'Explained the topic patiently until it clicked.',
    'Went out of the way to find the right shop. Appreciated.',
  ],
  requester: [
    'Clear instructions and paid immediately.',
    'Very polite, easy to coordinate with.',
    'Paid right after I confirmed. No issues at all.',
    'Told me exactly where to go. Smooth transaction.',
  ],
} as const;
