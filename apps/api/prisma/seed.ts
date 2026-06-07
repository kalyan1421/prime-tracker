import { PrismaClient } from '@prisma/client';

const prisma = new PrismaClient();

// ---- Helper: determine unit status from Excel columns ----
function mapUnitStatus(
  sold?: string,
  leased?: string,
): 'AVAILABLE' | 'SOLD' | 'LEASED' | 'UNDER_CONTRACT' | 'OCCUPIED' {
  const s = (sold || '').trim().toLowerCase();
  const l = (leased || '').trim().toLowerCase();

  if (l.includes('owner occupied')) return 'OCCUPIED';
  if (l.includes('lease pending') || l.includes('lease yet to finalize')) return 'UNDER_CONTRACT';
  if (l.includes('leased')) return 'LEASED';
  if (s === 'sold') return 'SOLD';
  if (s === 'unsold') return 'AVAILABLE';
  return 'AVAILABLE';
}

// ---- Helper: parse sqft from strings like "1296 SF" or numbers ----
function parseSqft(val: string | number | undefined): number | null {
  if (val === undefined || val === null || val === '') return null;
  if (typeof val === 'number') return Math.round(val);
  const num = parseInt(val.replace(/[^0-9]/g, ''), 10);
  return isNaN(num) ? null : num;
}

// ---- Unit type interface ----
interface UnitData {
  unitNumber: string;
  sqft: number | null;
  sold?: string;
  leased?: string;
  businessName?: string;
  buyerName?: string;
  pricePerSf?: number;
  unitType?: 'RETAIL' | 'MEDICAL' | 'FLEX' | 'RESIDENTIAL_LOT' | 'OFFICE' | 'RESTAURANT' | 'EVENT_CENTER';
}

interface BuildingData {
  name: string;
  units: UnitData[];
}

interface ProjectData {
  name: string;
  slug: string;
  location: string;
  phase: 'PRE_DEVELOPMENT' | 'PERMITTING' | 'CONSTRUCTION' | 'LEASE_UP' | 'STABILIZED' | 'SOLD_REFI';
  status: 'ACTIVE' | 'COMPLETED';
  buildings: BuildingData[];
}

// ============================================================
// PROJECT DATA FROM EXCEL
// ============================================================

const projects: ProjectData[] = [
  // ---- 1. Centro Plaza ----
  {
    name: 'Centro Plaza',
    slug: 'centro-plaza',
    location: 'Texas',
    phase: 'LEASE_UP',
    status: 'ACTIVE',
    buildings: [
      {
        name: 'Building 1',
        units: [
          { unitNumber: '101', sqft: 1296, leased: 'Leased', businessName: 'Bagel', unitType: 'RETAIL' },
          { unitNumber: '102', sqft: 1468, sold: 'Sold', leased: 'Leased', businessName: 'Farm 2 Cook', buyerName: 'Durga Prasad Chinthala, Keerthi Alla and Shibu Thomas', unitType: 'RETAIL' },
          { unitNumber: '103', sqft: 1511, leased: 'Leased', businessName: 'Cream Stone', unitType: 'RETAIL' },
          { unitNumber: '104', sqft: 1509, sold: 'Sold', leased: 'Leased', businessName: 'Sangam', buyerName: 'Suman Thatipalli', unitType: 'RETAIL' },
          { unitNumber: '105', sqft: 1441, sold: 'Sold', leased: 'Leased', unitType: 'RETAIL' },
          { unitNumber: '106', sqft: 1291, sold: 'Sold', leased: 'Leased', unitType: 'RETAIL' },
        ],
      },
      {
        name: 'Building 2',
        units: [
          { unitNumber: '201', sqft: 1296, leased: 'Leased', businessName: 'Guru Liquors', unitType: 'RETAIL' },
          { unitNumber: '202', sqft: 1468, unitType: 'RETAIL' },
          { unitNumber: '203', sqft: 1511, sold: 'Unsold', pricePerSf: 460, unitType: 'RETAIL' },
          { unitNumber: '204', sqft: 1509, sold: 'Unsold', pricePerSf: 460, unitType: 'RETAIL' },
          { unitNumber: '205', sqft: 1441, sold: 'Sold', businessName: 'Smoke Shop', buyerName: 'Divya Kallu, Ashwin Kumar Gadagoni, Ranjith Kumar Dharmavarapu', unitType: 'RETAIL' },
          { unitNumber: '206', sqft: 1291, sold: 'Sold', businessName: 'Pizza Depot', buyerName: 'Swarajya, Maheswara Rao Kurapati', unitType: 'RETAIL' },
        ],
      },
      {
        name: 'Building 3',
        units: [
          { unitNumber: '301', sqft: 1296, sold: 'Sold', businessName: 'Citizens Bank', buyerName: 'Sindhi Mekala', unitType: 'RETAIL' },
          { unitNumber: '302', sqft: 1468, sold: 'Sold', businessName: 'Teapioca', unitType: 'RETAIL' },
          { unitNumber: '303', sqft: 1511, sold: 'Sold', businessName: 'Luxe Massage Spa', unitType: 'RETAIL' },
          { unitNumber: '304', sqft: 1509, sold: 'Sold', buyerName: 'Sujit Murukan', unitType: 'RETAIL' },
          { unitNumber: '305', sqft: 1441, sold: 'Sold', businessName: 'Qahwah House', unitType: 'RETAIL' },
          { unitNumber: '306', sqft: 1291, sold: 'Sold', unitType: 'RETAIL' },
        ],
      },
      {
        name: 'Building 4',
        units: [
          { unitNumber: '401', sqft: 1296, sold: 'Sold', buyerName: 'Ramaseshu Ravepati', unitType: 'RETAIL' },
          { unitNumber: '402', sqft: 1468, sold: 'Sold', buyerName: 'Srinivas Patlolla', unitType: 'RETAIL' },
          { unitNumber: '403', sqft: 1511, sold: 'Sold', businessName: 'Asli Modest Wear', buyerName: 'Venkata Vidya Sagar Reddy Karumuri, Srinivas Reddy Guda, Deepthi Komandla', unitType: 'RETAIL' },
          { unitNumber: '404', sqft: 1509, sold: 'Sold', buyerName: 'Srinivas Patlolla', unitType: 'RETAIL' },
          { unitNumber: '405', sqft: 1441, sold: 'Sold', businessName: 'Physician', buyerName: 'Jaimin Maganbhai Patel', unitType: 'MEDICAL' },
          { unitNumber: '406', sqft: 1291, sold: 'Sold', buyerName: 'Sivakumar Manikanteswaran', unitType: 'RETAIL' },
        ],
      },
      {
        name: 'Building 5',
        units: [
          { unitNumber: '501', sqft: 1411, sold: 'Sold', businessName: 'India Bazar', buyerName: 'Gopal Pabari', unitType: 'RETAIL' },
          { unitNumber: '502', sqft: 1239, sold: 'Sold', unitType: 'RETAIL' },
          { unitNumber: '503', sqft: 995, sold: 'Sold', unitType: 'RETAIL' },
          { unitNumber: '504', sqft: 1118, sold: 'Sold', unitType: 'RETAIL' },
          { unitNumber: '505', sqft: 1452, sold: 'Sold', unitType: 'RETAIL' },
          { unitNumber: '506', sqft: 1118, sold: 'Sold', unitType: 'RETAIL' },
          { unitNumber: '507', sqft: 995, sold: 'Sold', unitType: 'RETAIL' },
          { unitNumber: '508', sqft: 1239, sold: 'Sold', unitType: 'RETAIL' },
          { unitNumber: '509', sqft: 1485, sold: 'Sold', unitType: 'RETAIL' },
        ],
      },
      {
        name: 'Building 6',
        units: [
          { unitNumber: '601', sqft: 3104, sold: 'Sold', buyerName: 'Srikanth Reddy Chalamalla and Rahul Reddy Malkireddy', unitType: 'RETAIL' },
          { unitNumber: '602', sqft: 3104, sold: 'Sold', buyerName: 'Ravi Thota', unitType: 'RETAIL' },
          { unitNumber: '603', sqft: 1061, sold: 'Unsold', pricePerSf: 320, unitType: 'RETAIL' },
          { unitNumber: '604', sqft: 1061, sold: 'Unsold', pricePerSf: 320, unitType: 'RETAIL' },
          { unitNumber: '605', sqft: 1057, sold: 'Unsold', leased: 'Lease Pending', businessName: 'DIY craft', pricePerSf: 320, unitType: 'RETAIL' },
          { unitNumber: '606', sqft: 1057, sold: 'Sold', businessName: 'Vivek Flowers', buyerName: 'Ramya Neeli', unitType: 'RETAIL' },
          { unitNumber: '607', sqft: 1042, sold: 'Unsold', pricePerSf: 320, unitType: 'RETAIL' },
          { unitNumber: '608', sqft: 1042, sold: 'Sold', businessName: 'Vivek Flowers', buyerName: 'Ramya Neeli', unitType: 'RETAIL' },
          { unitNumber: '609', sqft: 1171, sold: 'Unsold', pricePerSf: 320, unitType: 'RETAIL' },
          { unitNumber: '610', sqft: 1171, sold: 'Sold', buyerName: 'Vikram Reddy Velma', unitType: 'RETAIL' },
          { unitNumber: '611', sqft: 1171, sold: 'Unsold', pricePerSf: 320, unitType: 'RETAIL' },
          { unitNumber: '612', sqft: 1171, sold: 'Sold', buyerName: 'Muralidhar Vusirikala', unitType: 'RETAIL' },
          { unitNumber: '613', sqft: 1042, sold: 'Unsold', pricePerSf: 320, unitType: 'RETAIL' },
          { unitNumber: '614', sqft: 1042, sold: 'Unsold', pricePerSf: 320, unitType: 'RETAIL' },
          { unitNumber: '615', sqft: 1057, sold: 'Unsold', pricePerSf: 320, unitType: 'RETAIL' },
          { unitNumber: '616', sqft: 1057, sold: 'Unsold', pricePerSf: 320, unitType: 'RETAIL' },
          { unitNumber: '617', sqft: 1059, sold: 'Sold', buyerName: 'Shailendra Kumar', unitType: 'RETAIL' },
          { unitNumber: '618', sqft: 1059, sold: 'Unsold', pricePerSf: 320, unitType: 'RETAIL' },
          { unitNumber: '619', sqft: 2037, sold: 'Unsold', pricePerSf: 460, unitType: 'RETAIL' },
          { unitNumber: '620', sqft: 1967, sold: 'Sold', buyerName: 'Varun Chandu Pakalapati', unitType: 'RETAIL' },
        ],
      },
      {
        name: 'Building 7',
        units: [
          { unitNumber: '701', sqft: 3104, leased: 'Leased', businessName: 'Play Ground (We Fun LLC)', unitType: 'EVENT_CENTER' },
          { unitNumber: '702', sqft: 3104, unitType: 'RETAIL' },
          { unitNumber: '703', sqft: 1061, unitType: 'RETAIL' },
          { unitNumber: '704', sqft: 1061, unitType: 'RETAIL' },
          { unitNumber: '705', sqft: 1057, unitType: 'RETAIL' },
          { unitNumber: '706', sqft: 1057, unitType: 'RETAIL' },
          { unitNumber: '707', sqft: 1042, leased: 'Leased', businessName: 'Salon', unitType: 'RETAIL' },
          { unitNumber: '708', sqft: 1042, unitType: 'RETAIL' },
          { unitNumber: '709', sqft: 1171, unitType: 'RETAIL' },
          { unitNumber: '710', sqft: 1171, unitType: 'RETAIL' },
          { unitNumber: '711', sqft: 1171, unitType: 'RETAIL' },
          { unitNumber: '712', sqft: 1171, unitType: 'RETAIL' },
          { unitNumber: '713', sqft: 1042, unitType: 'RETAIL' },
          { unitNumber: '714', sqft: 1042, unitType: 'RETAIL' },
          { unitNumber: '715', sqft: 1057, leased: 'Leased', businessName: 'Mugdha', unitType: 'RETAIL' },
          { unitNumber: '716', sqft: 1057, unitType: 'RETAIL' },
          { unitNumber: '717', sqft: 1059, unitType: 'RETAIL' },
          { unitNumber: '718', sqft: 1059, unitType: 'RETAIL' },
          { unitNumber: '719', sqft: 2037, unitType: 'RETAIL' },
          { unitNumber: '720', sqft: 1967, unitType: 'RETAIL' },
        ],
      },
      {
        name: 'Building 8',
        units: [
          { unitNumber: '801', sqft: 3104, sold: 'Sold', buyerName: 'Jayadev velkuri', unitType: 'RETAIL' },
          { unitNumber: '802', sqft: 3104, sold: 'Sold', buyerName: 'Ravi chandra reddy matavalam', unitType: 'RETAIL' },
          { unitNumber: '803', sqft: 1061, sold: 'Sold', buyerName: 'Rajesh Gandham', unitType: 'RETAIL' },
          { unitNumber: '804', sqft: 1061, sold: 'Sold', buyerName: 'Venkata Ramana Madasu', unitType: 'RETAIL' },
          { unitNumber: '805', sqft: 1057, sold: 'Unsold', pricePerSf: 320, unitType: 'RETAIL' },
          { unitNumber: '806', sqft: 1057, sold: 'Sold', buyerName: 'Shyam Bolishetty, Sivakaami Sukumaran', unitType: 'RETAIL' },
          { unitNumber: '807', sqft: 1042, sold: 'Unsold', pricePerSf: 320, unitType: 'RETAIL' },
          { unitNumber: '808', sqft: 1042, sold: 'Sold', buyerName: 'Lakshmidevi Pavali / Manoj kumar Thota', unitType: 'RETAIL' },
          { unitNumber: '809', sqft: 1171, sold: 'Unsold', pricePerSf: 320, unitType: 'RETAIL' },
          { unitNumber: '810', sqft: 1171, sold: 'Sold', buyerName: 'Bhavana gadey', unitType: 'RETAIL' },
          { unitNumber: '811', sqft: 1171, sold: 'Unsold', pricePerSf: 320, unitType: 'RETAIL' },
          { unitNumber: '812', sqft: 1171, sold: 'Sold', buyerName: 'Praveen Katapally', unitType: 'RETAIL' },
          { unitNumber: '813', sqft: 1042, sold: 'Unsold', pricePerSf: 320, unitType: 'RETAIL' },
          { unitNumber: '814', sqft: 1042, sold: 'Sold', buyerName: 'Praveen Katapally', unitType: 'RETAIL' },
          { unitNumber: '815', sqft: 1057, sold: 'Unsold', pricePerSf: 320, unitType: 'RETAIL' },
          { unitNumber: '816', sqft: 1057, sold: 'Sold', buyerName: 'Deshkanth Yathamshetti', unitType: 'RETAIL' },
          { unitNumber: '817', sqft: 1059, sold: 'Sold', buyerName: 'Raghavendra Yarlagadda', unitType: 'RETAIL' },
          { unitNumber: '818', sqft: 1059, sold: 'Sold', buyerName: 'Sridhar Reddy Duvanthala', unitType: 'RETAIL' },
          { unitNumber: '819', sqft: 2037, sold: 'Sold', buyerName: 'Naveen Valeti', unitType: 'RETAIL' },
          { unitNumber: '820', sqft: 1967, sold: 'Sold', buyerName: 'Mahesh sake', unitType: 'RETAIL' },
        ],
      },
      {
        name: 'Building 9',
        units: [
          { unitNumber: '901', sqft: 2095, sold: 'Sold', leased: 'Leased', businessName: 'Lava', buyerName: 'Raghunath Reddy Maddirala, Vishwanth Reddy Cherlacolu, Sunil Reddy Peechu and Abhishek Chandan Gujjar', unitType: 'RESTAURANT' },
          { unitNumber: '902', sqft: 1624, sold: 'Unsold', pricePerSf: 460, unitType: 'RETAIL' },
          { unitNumber: '903', sqft: 1118, sold: 'Sold', buyerName: 'Kalyan Krishna Yarnagula', unitType: 'RETAIL' },
          { unitNumber: '904', sqft: 1452, sold: 'Unsold', pricePerSf: 320, unitType: 'RETAIL' },
          { unitNumber: '905', sqft: 1118, sold: 'Sold', buyerName: 'Chaitanya P Adapa', unitType: 'RETAIL' },
          { unitNumber: '906', sqft: 995, sold: 'Sold', buyerName: 'Vijayalakshmi Vallepall', unitType: 'RETAIL' },
          { unitNumber: '907', sqft: 1239, sold: 'Sold', buyerName: 'Venu Arety, Venkata Kalyan Cheemaladhine', unitType: 'RETAIL' },
          { unitNumber: '908', sqft: 1421, sold: 'Sold', buyerName: 'Hannah Dasari', unitType: 'RETAIL' },
        ],
      },
      {
        name: 'Building 10',
        units: [
          { unitNumber: '1001', sqft: 1421, sold: 'Unsold', businessName: 'Day Care', pricePerSf: 380, unitType: 'RETAIL' },
          { unitNumber: '1002', sqft: 1239, sold: 'Unsold', pricePerSf: 380, unitType: 'RETAIL' },
          { unitNumber: '1003', sqft: 995, sold: 'Unsold', pricePerSf: 380, unitType: 'RETAIL' },
          { unitNumber: '1004', sqft: 1118, sold: 'Unsold', pricePerSf: 380, unitType: 'RETAIL' },
          { unitNumber: '1005', sqft: 1452, sold: 'Unsold', pricePerSf: 380, unitType: 'RETAIL' },
          { unitNumber: '1006', sqft: 1118, sold: 'Unsold', pricePerSf: 380, unitType: 'RETAIL' },
          { unitNumber: '1007', sqft: 995, sold: 'Unsold', pricePerSf: 380, unitType: 'RETAIL' },
          { unitNumber: '1008', sqft: 1239, sold: 'Unsold', pricePerSf: 380, unitType: 'RETAIL' },
          { unitNumber: '1009', sqft: 1485, sold: 'Unsold', pricePerSf: 380, unitType: 'RETAIL' },
        ],
      },
    ],
  },

  // ---- 2. Leander ----
  {
    name: 'Leander',
    slug: 'leander',
    location: 'Leander, TX',
    phase: 'LEASE_UP',
    status: 'ACTIVE',
    buildings: [
      {
        name: 'Building 1',
        units: [
          { unitNumber: '100', sqft: 23400, sold: 'Sold', leased: 'Leased', businessName: '22 Yards Austin', unitType: 'EVENT_CENTER' },
        ],
      },
      {
        name: 'Building 2',
        units: [
          { unitNumber: '200', sqft: 2369, sold: 'Unsold', unitType: 'FLEX' },
          { unitNumber: '205', sqft: 2369, sold: 'Unsold', unitType: 'FLEX' },
          { unitNumber: '210', sqft: 1650, sold: 'Unsold', unitType: 'FLEX' },
          { unitNumber: '215', sqft: 1650, sold: 'Unsold', unitType: 'FLEX' },
          { unitNumber: '220', sqft: 1650, sold: 'Unsold', pricePerSf: 310, unitType: 'FLEX' },
          { unitNumber: '225', sqft: 1650, sold: 'Unsold', pricePerSf: 310, unitType: 'FLEX' },
          { unitNumber: '230', sqft: 1650, sold: 'Unsold', pricePerSf: 310, unitType: 'FLEX' },
          { unitNumber: '235', sqft: 1650, sold: 'Unsold', pricePerSf: 310, unitType: 'FLEX' },
          { unitNumber: '240', sqft: 1650, sold: 'Unsold', pricePerSf: 310, unitType: 'FLEX' },
          { unitNumber: '245', sqft: 1650, sold: 'Unsold', pricePerSf: 310, unitType: 'FLEX' },
          { unitNumber: '250', sqft: 1650, sold: 'Unsold', pricePerSf: 310, unitType: 'FLEX' },
          { unitNumber: '255', sqft: 1650, sold: 'Unsold', pricePerSf: 310, unitType: 'FLEX' },
          { unitNumber: '260', sqft: 1650, sold: 'Unsold', pricePerSf: 310, unitType: 'FLEX' },
          { unitNumber: '265', sqft: 1650, sold: 'Unsold', pricePerSf: 310, unitType: 'FLEX' },
          { unitNumber: '270', sqft: 1650, sold: 'Unsold', pricePerSf: 310, unitType: 'FLEX' },
          { unitNumber: '275', sqft: 1650, sold: 'Unsold', pricePerSf: 310, unitType: 'FLEX' },
          { unitNumber: '280', sqft: 1650, sold: 'Unsold', pricePerSf: 310, unitType: 'FLEX' },
          { unitNumber: '285', sqft: 1650, sold: 'Unsold', pricePerSf: 310, unitType: 'FLEX' },
          { unitNumber: '290', sqft: 2249, sold: 'Unsold', pricePerSf: 310, unitType: 'FLEX' },
          { unitNumber: '295', sqft: 2369, sold: 'Unsold', pricePerSf: 310, unitType: 'FLEX' },
        ],
      },
      {
        name: 'Building 3',
        units: [
          { unitNumber: '300', sqft: 2369, sold: 'Sold', unitType: 'FLEX' },
          { unitNumber: '305', sqft: 2369, sold: 'Sold', unitType: 'FLEX' },
          { unitNumber: '310', sqft: 1650, sold: 'Sold', unitType: 'FLEX' },
          { unitNumber: '315', sqft: 1650, sold: 'Sold', leased: 'Leased', businessName: 'R1 Dent Repair', unitType: 'FLEX' },
          { unitNumber: '320', sqft: 1650, sold: 'Sold', unitType: 'FLEX' },
          { unitNumber: '325', sqft: 1650, sold: 'Sold', unitType: 'FLEX' },
          { unitNumber: '330', sqft: 1650, sold: 'Sold', unitType: 'FLEX' },
          { unitNumber: '335', sqft: 1650, sold: 'Sold', leased: 'Leased', businessName: 'Three Wheels Gym', unitType: 'FLEX' },
          { unitNumber: '340', sqft: 1650, sold: 'Sold', unitType: 'FLEX' },
          { unitNumber: '345', sqft: 1650, sold: 'Sold', leased: 'Owner Occupied', businessName: 'BritePro Audio/Video Sales', unitType: 'FLEX' },
          { unitNumber: '350', sqft: 1650, sold: 'Sold', unitType: 'FLEX' },
          { unitNumber: '355', sqft: 1650, sold: 'Sold', unitType: 'FLEX' },
          { unitNumber: '360', sqft: 1650, sold: 'Sold', leased: 'Leased', businessName: 'Auto Cosmetics', unitType: 'FLEX' },
          { unitNumber: '365', sqft: 1650, sold: 'Sold', leased: 'Leased', businessName: 'Dance Studio', unitType: 'FLEX' },
          { unitNumber: '370', sqft: 1650, sold: 'Sold', unitType: 'FLEX' },
          { unitNumber: '375', sqft: 1650, sold: 'Sold', leased: 'Leased', businessName: 'Lego Toys', unitType: 'FLEX' },
          { unitNumber: '380', sqft: 1650, sold: 'Sold', unitType: 'FLEX' },
          { unitNumber: '385', sqft: 1650, sold: 'Sold', leased: 'Owner Occupied', businessName: 'Lego Toys', unitType: 'FLEX' },
          { unitNumber: '390', sqft: 2369, sold: 'Sold', unitType: 'FLEX' },
          { unitNumber: '395', sqft: 2249, sold: 'Sold', businessName: 'Prime Office', unitType: 'OFFICE' },
        ],
      },
      {
        name: 'Building 4',
        units: [
          { unitNumber: '400', sqft: 2369, sold: 'Unsold', pricePerSf: 330, unitType: 'FLEX' },
          { unitNumber: '405', sqft: 1650, sold: 'Unsold', leased: 'Leased', businessName: 'Perfect Posture', pricePerSf: 433, unitType: 'FLEX' },
          { unitNumber: '410', sqft: 1650, sold: 'Unsold', pricePerSf: 310, unitType: 'FLEX' },
          { unitNumber: '415', sqft: 1650, sold: 'Unsold', pricePerSf: 310, unitType: 'FLEX' },
          { unitNumber: '420', sqft: 1650, sold: 'Unsold', pricePerSf: 310, unitType: 'FLEX' },
          { unitNumber: '425', sqft: 1650, sold: 'Unsold', pricePerSf: 310, unitType: 'FLEX' },
          { unitNumber: '430', sqft: 1650, sold: 'Unsold', pricePerSf: 310, unitType: 'FLEX' },
          { unitNumber: '435', sqft: 1650, sold: 'Unsold', pricePerSf: 310, unitType: 'FLEX' },
          { unitNumber: '440', sqft: 1650, sold: 'Unsold', pricePerSf: 310, unitType: 'FLEX' },
          { unitNumber: '445', sqft: 1650, sold: 'Unsold', pricePerSf: 460, unitType: 'FLEX' },
          { unitNumber: '450', sqft: 1650, sold: 'Unsold', pricePerSf: 460, unitType: 'FLEX' },
          { unitNumber: '455', sqft: 2369, sold: 'Unsold', pricePerSf: 460, unitType: 'FLEX' },
          { unitNumber: '460', sqft: 2369, sold: 'Unsold', pricePerSf: 460, unitType: 'FLEX' },
          { unitNumber: '465', sqft: 2249, sold: 'Sold', unitType: 'FLEX' },
          { unitNumber: '470', sqft: 1650, sold: 'Sold', unitType: 'FLEX' },
          { unitNumber: '475', sqft: 1650, sold: 'Sold', unitType: 'FLEX' },
          { unitNumber: '480', sqft: 1650, sold: 'Sold', unitType: 'FLEX' },
          { unitNumber: '485', sqft: 1650, sold: 'Sold', unitType: 'FLEX' },
          { unitNumber: '490', sqft: 1650, sold: 'Sold', unitType: 'FLEX' },
          { unitNumber: '495', sqft: 1650, sold: 'Sold', unitType: 'FLEX' },
        ],
      },
      {
        name: 'Building 5',
        units: [
          { unitNumber: '510', sqft: 5850, sold: 'Sold', leased: 'Leased', businessName: 'Indian Bawarchi', unitType: 'RESTAURANT' },
        ],
      },
    ],
  },

  // ---- 3. Lewisville Phase 1 ----
  {
    name: 'Lewisville Phase 1',
    slug: 'lewisville-phase-1',
    location: 'Lewisville, TX',
    phase: 'STABILIZED',
    status: 'ACTIVE',
    buildings: [
      {
        name: 'Building 1',
        units: [
          { unitNumber: '101', sqft: 6490, sold: 'Sold', leased: 'Owner Occupied', businessName: 'Proton Products INC', unitType: 'FLEX' },
          { unitNumber: '102', sqft: 5130, sold: 'Sold', leased: 'Owner Occupied', unitType: 'FLEX' },
          { unitNumber: '103', sqft: 2607, sold: 'Sold', unitType: 'FLEX' },
          { unitNumber: '104', sqft: 2118, sold: 'Sold', leased: 'Leased', unitType: 'FLEX' },
          { unitNumber: '105', sqft: 2118, sold: 'Sold', leased: 'Leased', businessName: 'inked house', unitType: 'FLEX' },
          { unitNumber: '106', sqft: 2607, sold: 'Sold', leased: 'Leased', businessName: '1-800-plumber+air', unitType: 'FLEX' },
          { unitNumber: '107', sqft: 2607, sold: 'Sold', leased: 'Leased', businessName: 'north texas services', unitType: 'FLEX' },
          { unitNumber: '108', sqft: 2118, sold: 'Sold', unitType: 'FLEX' },
          { unitNumber: '109', sqft: 2118, sold: 'Sold', leased: 'Owner Occupied', businessName: 'R2 realty', unitType: 'OFFICE' },
          { unitNumber: '110', sqft: 2607, sold: 'Sold', leased: 'Owner Occupied', unitType: 'FLEX' },
          { unitNumber: '111', sqft: 3150, sold: 'Sold', leased: 'Leased', businessName: 'cosplay maker space', unitType: 'FLEX' },
          { unitNumber: '112', sqft: 2118, sold: 'Sold', unitType: 'FLEX' },
          { unitNumber: '114', sqft: 2607, sold: 'Sold', leased: 'Leased', businessName: 'Olympic fit', unitType: 'FLEX' },
          { unitNumber: '116', sqft: 2118, sold: 'Sold', leased: 'Owner Occupied', businessName: 'PDS equipmen central', unitType: 'FLEX' },
          { unitNumber: '118', sqft: 3021, sold: 'Sold', leased: 'Owner Occupied', businessName: 'EMS barcode solutions', unitType: 'FLEX' },
        ],
      },
      {
        name: 'Building 2',
        units: [
          { unitNumber: '201', sqft: 2478, sold: 'Sold', leased: 'Owner Occupied', businessName: 'Byte Graph Productions', unitType: 'FLEX' },
          { unitNumber: '202', sqft: 2235, sold: 'Sold', leased: 'Owner Occupied', businessName: 'Blueline Roofing', unitType: 'FLEX' },
          { unitNumber: '203', sqft: 2118, sold: 'Sold', leased: 'Not Leased', unitType: 'FLEX' },
          { unitNumber: '204', sqft: 1815, sold: 'Sold', unitType: 'FLEX' },
          { unitNumber: '205', sqft: 2118, sold: 'Sold', unitType: 'FLEX' },
          { unitNumber: '206', sqft: 1815, sold: 'Sold', unitType: 'FLEX' },
          { unitNumber: '207', sqft: 2607, sold: 'Sold', leased: 'Leased', businessName: 'Nhance nutrition', unitType: 'FLEX' },
          { unitNumber: '208', sqft: 2235, sold: 'Sold', unitType: 'FLEX' },
          { unitNumber: '209', sqft: 2118, sold: 'Sold', leased: 'Leased', businessName: 'OI hats', unitType: 'FLEX' },
          { unitNumber: '210', sqft: 1815, sold: 'Sold', leased: 'Owner Occupied', businessName: 'Title wave sports', unitType: 'RETAIL' },
          { unitNumber: '211', sqft: 2607, sold: 'Sold', leased: 'Owner Occupied', businessName: 'Arrow Head roofing', unitType: 'FLEX' },
          { unitNumber: '212', sqft: 2235, sold: 'Sold', unitType: 'FLEX' },
          { unitNumber: '213', sqft: 2118, sold: 'Sold', unitType: 'FLEX' },
          { unitNumber: '214', sqft: 1815, sold: 'Sold', leased: 'Leased', businessName: 'Garage Magic', unitType: 'FLEX' },
          { unitNumber: '215', sqft: 2607, sold: 'Sold', leased: 'Leased', businessName: 'HGI financial services', unitType: 'OFFICE' },
          { unitNumber: '216', sqft: 2235, sold: 'Sold', unitType: 'FLEX' },
        ],
      },
      {
        name: 'Building 3',
        units: [
          { unitNumber: '301', sqft: 5190, sold: 'Sold', leased: 'Owner Occupied', businessName: 'Infiray', unitType: 'FLEX' },
          { unitNumber: '302', sqft: 2941, sold: 'Sold', leased: 'Owner Occupied', unitType: 'FLEX' },
          { unitNumber: '303', sqft: 2118, sold: 'Sold', leased: 'Owner Occupied', unitType: 'FLEX' },
          { unitNumber: '304', sqft: 1815, sold: 'Sold', leased: 'Owner Occupied', unitType: 'FLEX' },
          { unitNumber: '305', sqft: 2607, sold: 'Sold', leased: 'Owner Occupied', unitType: 'FLEX' },
          { unitNumber: '306', sqft: 2235, sold: 'Sold', leased: 'Owner Occupied', businessName: 'Infiray', unitType: 'FLEX' },
          { unitNumber: '307', sqft: 2118, sold: 'Sold', unitType: 'FLEX' },
          { unitNumber: '308', sqft: 1815, sold: 'Sold', leased: 'Owner Occupied', businessName: 'Infiray', unitType: 'FLEX' },
          { unitNumber: '309', sqft: 2478, sold: 'Sold', leased: 'Leased', businessName: 'Art Of Living', unitType: 'FLEX' },
          { unitNumber: '310', sqft: 2235, sold: 'Sold', leased: 'Leased', unitType: 'FLEX' },
          { unitNumber: '312', sqft: 1815, sold: 'Sold', leased: 'Owner Occupied', businessName: 'MC Hand bags', unitType: 'RETAIL' },
          { unitNumber: '314', sqft: 2235, sold: 'Sold', leased: 'Owner Occupied', businessName: 'Stephany ficut', unitType: 'RETAIL' },
        ],
      },
      {
        name: 'Building 4',
        units: [
          { unitNumber: '401', sqft: 2478, sold: 'Sold', leased: 'Owner Occupied', businessName: 'Purple & Remoelling & Renovations', unitType: 'FLEX' },
          { unitNumber: '402', sqft: 2235, sold: 'Unsold', pricePerSf: 340, unitType: 'FLEX' },
          { unitNumber: '403', sqft: 2118, sold: 'Unsold', pricePerSf: 340, unitType: 'FLEX' },
          { unitNumber: '404', sqft: 1815, sold: 'Unsold', pricePerSf: 340, unitType: 'FLEX' },
          { unitNumber: '405', sqft: 2118, sold: 'Sold', leased: 'Leased', businessName: '22 yards dallas', unitType: 'FLEX' },
          { unitNumber: '406', sqft: 1815, sold: 'Sold', leased: 'Leased', unitType: 'FLEX' },
          { unitNumber: '407', sqft: 2607, sold: 'Sold', leased: 'Leased', unitType: 'FLEX' },
          { unitNumber: '408', sqft: 2235, sold: 'Sold', leased: 'Leased', unitType: 'FLEX' },
          { unitNumber: '409', sqft: 2118, sold: 'Sold', leased: 'Leased', unitType: 'FLEX' },
          { unitNumber: '410', sqft: 1815, sold: 'Sold', leased: 'Leased', unitType: 'FLEX' },
          { unitNumber: '411', sqft: 2607, sold: 'Sold', leased: 'Leased', unitType: 'FLEX' },
          { unitNumber: '412', sqft: 2235, sold: 'Sold', leased: 'Leased', unitType: 'FLEX' },
          { unitNumber: '413', sqft: 2118, sold: 'Sold', leased: 'Leased', unitType: 'FLEX' },
          { unitNumber: '414', sqft: 1815, sold: 'Sold', leased: 'Leased', unitType: 'FLEX' },
          { unitNumber: '415', sqft: 2607, sold: 'Sold', leased: 'Leased', unitType: 'FLEX' },
          { unitNumber: '416', sqft: 2235, sold: 'Sold', leased: 'Leased', unitType: 'FLEX' },
        ],
      },
      {
        name: 'Building 5',
        units: [
          { unitNumber: '501', sqft: 3412, sold: 'Unsold', leased: 'Lease yet to finalize', pricePerSf: 340, unitType: 'FLEX' },
          { unitNumber: '503', sqft: 2118, sold: 'Unsold', pricePerSf: 340, unitType: 'FLEX' },
          { unitNumber: '505', sqft: 2607, sold: 'Unsold', pricePerSf: 340, unitType: 'FLEX' },
          { unitNumber: '507', sqft: 2118, sold: 'Unsold', pricePerSf: 340, unitType: 'FLEX' },
          { unitNumber: '511', sqft: 2118, sold: 'Unsold', pricePerSf: 340, unitType: 'FLEX' },
          { unitNumber: '513', sqft: 2607, sold: 'Unsold', leased: 'Leased', businessName: 'Harvest depot', pricePerSf: 525, unitType: 'FLEX' },
          { unitNumber: '515', sqft: 2118, sold: 'Unsold', leased: 'Leased', businessName: 'Harvest depot', pricePerSf: 525, unitType: 'FLEX' },
          { unitNumber: '516', sqft: 1815, sold: 'Unsold', leased: 'Leased', businessName: 'N & S Retail', pricePerSf: 384, unitType: 'RETAIL' },
          { unitNumber: '506', sqft: 2235, sold: 'Sold', leased: 'Owner Occupied', unitType: 'FLEX' },
          { unitNumber: '502', sqft: 3777, sold: 'Sold', leased: 'Owner Occupied', unitType: 'FLEX' },
          { unitNumber: '504', sqft: 1815, sold: 'Sold', leased: 'Owner Occupied', unitType: 'FLEX' },
          { unitNumber: '508', sqft: 1815, sold: 'Sold', leased: 'Owner Occupied', unitType: 'FLEX' },
          { unitNumber: '509', sqft: 2607, sold: 'Sold', unitType: 'FLEX' },
          { unitNumber: '510', sqft: 2235, sold: 'Sold', leased: 'Owner Occupied', unitType: 'FLEX' },
          { unitNumber: '512', sqft: 1815, sold: 'Sold', leased: 'Owner Occupied', businessName: 'Smart dots', unitType: 'FLEX' },
          { unitNumber: '514', sqft: 2235, sold: 'Sold', leased: 'Owner Occupied', unitType: 'FLEX' },
          { unitNumber: '517', sqft: 2478, sold: 'Sold', leased: 'Leased', businessName: 'Merge Doors and Windows', unitType: 'FLEX' },
          { unitNumber: '518', sqft: 2235, sold: 'Sold', unitType: 'FLEX' },
        ],
      },
    ],
  },

  // ---- 4. Lewisville Phase 2 ----
  {
    name: 'Lewisville Phase 2',
    slug: 'lewisville-phase-2',
    location: 'Lewisville, TX',
    phase: 'CONSTRUCTION',
    status: 'ACTIVE',
    buildings: [
      {
        name: 'Building 6',
        units: [
          { unitNumber: '601', sqft: 6923, sold: 'Unsold', pricePerSf: 350, unitType: 'FLEX' },
          { unitNumber: '602', sqft: 9282, sold: 'Unsold', pricePerSf: 350, unitType: 'FLEX' },
          { unitNumber: '603', sqft: 3957, sold: 'Unsold', pricePerSf: 350, unitType: 'FLEX' },
          { unitNumber: '604', sqft: 3375, sold: 'Unsold', pricePerSf: 350, unitType: 'FLEX' },
          { unitNumber: '605', sqft: 3957, sold: 'Unsold', pricePerSf: 350, unitType: 'FLEX' },
          { unitNumber: '606', sqft: 3375, sold: 'Unsold', pricePerSf: 350, unitType: 'FLEX' },
          { unitNumber: '607', sqft: 3957, sold: 'Unsold', pricePerSf: 350, unitType: 'FLEX' },
          { unitNumber: '608', sqft: 9151, sold: 'Unsold', pricePerSf: 350, unitType: 'FLEX' },
          { unitNumber: '609', sqft: 3957, sold: 'Unsold', pricePerSf: 350, unitType: 'FLEX' },
          { unitNumber: '611', sqft: 6923, sold: 'Unsold', pricePerSf: 350, unitType: 'FLEX' },
        ],
      },
      {
        name: 'Building 7',
        units: [
          { unitNumber: '701', sqft: 6159, sold: 'Unsold', pricePerSf: 350, unitType: 'FLEX' },
          { unitNumber: '702', sqft: 6289, sold: 'Unsold', pricePerSf: 350, unitType: 'FLEX' },
          { unitNumber: '703', sqft: 3604, sold: 'Unsold', pricePerSf: 350, unitType: 'FLEX' },
          { unitNumber: '704', sqft: 3604, sold: 'Unsold', pricePerSf: 350, unitType: 'FLEX' },
          { unitNumber: '705', sqft: 3604, sold: 'Unsold', pricePerSf: 350, unitType: 'FLEX' },
          { unitNumber: '706', sqft: 3604, sold: 'Unsold', pricePerSf: 350, unitType: 'FLEX' },
          { unitNumber: '707', sqft: 3604, sold: 'Unsold', pricePerSf: 350, unitType: 'FLEX' },
          { unitNumber: '708', sqft: 3604, sold: 'Unsold', pricePerSf: 350, unitType: 'FLEX' },
          { unitNumber: '709', sqft: 3604, sold: 'Unsold', pricePerSf: 350, unitType: 'FLEX' },
          { unitNumber: '710', sqft: 3604, sold: 'Unsold', pricePerSf: 350, unitType: 'FLEX' },
          { unitNumber: '711', sqft: 6290, sold: 'Unsold', pricePerSf: 350, unitType: 'FLEX' },
          { unitNumber: '712', sqft: 3604, sold: 'Unsold', pricePerSf: 350, unitType: 'FLEX' },
        ],
      },
    ],
  },

  // ---- 5. RRC Phase 1 ----
  {
    name: 'RRC Phase 1',
    slug: 'rrc-phase-1',
    location: 'Texas',
    phase: 'STABILIZED',
    status: 'ACTIVE',
    buildings: [
      {
        name: 'Building 1',
        units: [
          { unitNumber: '100', sqft: 1043, sold: 'Sold', businessName: 'Hair and Beauty Salon', buyerName: 'Sai Santhosh Tallapally', unitType: 'RETAIL' },
          { unitNumber: '102', sqft: 1424, sold: 'Sold', buyerName: 'Nikhil Tej Paluvai Sailaja Nageswar Rao and Sneha Sirnam', unitType: 'RETAIL' },
          { unitNumber: '104', sqft: 1463, sold: 'Sold', businessName: 'Keds Ice Cream', buyerName: 'Chanakya Sunku', unitType: 'RETAIL' },
          { unitNumber: '106', sqft: 1462, sold: 'Sold', unitType: 'RETAIL' },
          { unitNumber: '108', sqft: 1665, sold: 'Sold', businessName: 'Foodistan', buyerName: 'Ravi Teja Thottempudi', unitType: 'RESTAURANT' },
          { unitNumber: '110', sqft: 1458, sold: 'Sold', unitType: 'RETAIL' },
          { unitNumber: '112', sqft: 1458, sold: 'Sold', unitType: 'RETAIL' },
          { unitNumber: '114', sqft: 2090, sold: 'Sold', unitType: 'RETAIL' },
        ],
      },
      {
        name: 'Building 2',
        units: [
          { unitNumber: '200', sqft: 2090, sold: 'Sold', buyerName: 'Ranadheer Vadlamudi', unitType: 'RETAIL' },
          { unitNumber: '202', sqft: 1458, sold: 'Sold', unitType: 'RETAIL' },
          { unitNumber: '204', sqft: 1462, sold: 'Sold', buyerName: 'Gopalakrishnan Raman & Deepa Balakrishnan', unitType: 'RETAIL' },
          { unitNumber: '206', sqft: 1672, sold: 'Sold', businessName: 'Primerose Dental', buyerName: 'Rojalina Nayak', unitType: 'MEDICAL' },
          { unitNumber: '208', sqft: 1465, sold: 'Sold', buyerName: 'Shiva Prasad Bomma, Sinduja Alugubelly', unitType: 'RETAIL' },
          { unitNumber: '210', sqft: 1458, sold: 'Sold', buyerName: 'Rajesh Reddy Kodoor and Vamshi Sharan Kumar Kandy', unitType: 'RETAIL' },
          { unitNumber: '212', sqft: 1430, sold: 'Sold', businessName: 'UPS', buyerName: 'Uma Mahesh Rao Gandavarapu, Rama Rao Venkata Kossireddi', unitType: 'RETAIL' },
          { unitNumber: '214', sqft: 1408, sold: 'Sold', buyerName: 'Gopalakrishnan Raman & Deepa Balakrishnan', unitType: 'RETAIL' },
        ],
      },
      {
        name: 'Building 3',
        units: [
          { unitNumber: '300', sqft: 3212, sold: 'Sold', businessName: 'Brass Tap', unitType: 'RESTAURANT' },
          { unitNumber: '302', sqft: 1514, sold: 'Sold', businessName: 'Smoke Shop', buyerName: 'Swarajya Lakshmi Kurapati and Maheswara Rao Kurapati', unitType: 'RETAIL' },
          { unitNumber: '303', sqft: 2124, sold: 'Sold', buyerName: 'Neha Mundra', unitType: 'RETAIL' },
          { unitNumber: '305', sqft: 2855, sold: 'Sold', businessName: 'Best Brains', buyerName: 'Ram Gudipalli', unitType: 'RETAIL' },
          { unitNumber: '306', sqft: 1430, sold: 'Sold', buyerName: 'Joe Andriadrose Jayabalan', unitType: 'RETAIL' },
          { unitNumber: '307', sqft: 1560, sold: 'Sold', buyerName: 'Rishikesh Rajammagari', unitType: 'RETAIL' },
          { unitNumber: '308', sqft: 1430, sold: 'Sold', buyerName: 'Shruthin Reddy Aleti', unitType: 'RETAIL' },
          { unitNumber: '309', sqft: 1657, sold: 'Sold', buyerName: 'Gunjot Singh Rana', unitType: 'RETAIL' },
          { unitNumber: '310', sqft: 1567, sold: 'Sold', buyerName: 'Suneel Boddepalli', unitType: 'RETAIL' },
        ],
      },
      {
        name: 'Building 4',
        units: [
          { unitNumber: '401', sqft: 1276, sold: 'Sold', businessName: 'Lumen Room', buyerName: 'Praveen reddy Mallu', unitType: 'RETAIL' },
          { unitNumber: '402', sqft: 1348, sold: 'Sold', buyerName: 'Venkat Ramana Katta', unitType: 'RETAIL' },
          { unitNumber: '403', sqft: 1422, sold: 'Sold', buyerName: 'Raghunandandas Argula', unitType: 'RETAIL' },
          { unitNumber: '404', sqft: 1269, sold: 'Sold', buyerName: 'Praveen Thadakamalla', unitType: 'RETAIL' },
          { unitNumber: '405', sqft: 1422, sold: 'Sold', buyerName: 'Surekha Ganne', unitType: 'RETAIL' },
          { unitNumber: '406', sqft: 1357, sold: 'Sold', buyerName: 'Swaroopa Matta', unitType: 'RETAIL' },
          { unitNumber: '407', sqft: 1357, sold: 'Sold', buyerName: 'Sharath K Salguti', unitType: 'RETAIL' },
          { unitNumber: '408', sqft: 1422, sold: 'Sold', buyerName: 'Naveen Kumar Burra', unitType: 'RETAIL' },
          { unitNumber: '409', sqft: 2723, sold: 'Sold', buyerName: 'Mathews CPA', unitType: 'OFFICE' },
          { unitNumber: '410', sqft: 2655, sold: 'Sold', businessName: 'Optometrist', buyerName: 'Satyendra Kallur', unitType: 'MEDICAL' },
        ],
      },
      {
        name: 'Building 5',
        units: [
          { unitNumber: '500', sqft: 1258, sold: 'Sold', buyerName: 'Venugopala N Medahalli', unitType: 'MEDICAL' },
          { unitNumber: '501', sqft: 1186, sold: 'Sold', buyerName: 'Pardha Saradhi Gupta Reddy', unitType: 'MEDICAL' },
          { unitNumber: '502', sqft: 977, sold: 'Sold', buyerName: 'Dinakara Phaneendra Kumar Piratla, Kiranmayee Camasamudram', unitType: 'MEDICAL' },
          { unitNumber: '503', sqft: 977, sold: 'Sold', buyerName: 'Ravi Kumar Alamanda', unitType: 'MEDICAL' },
          { unitNumber: '504', sqft: 905, sold: 'Sold', buyerName: 'Murali Tanniru', unitType: 'MEDICAL' },
          { unitNumber: '505', sqft: 905, sold: 'Sold', buyerName: 'Sundeep Amirineni', unitType: 'MEDICAL' },
          { unitNumber: '506', sqft: 976, sold: 'Sold', businessName: 'Tax filing office', buyerName: 'Srikanth Punukula', unitType: 'OFFICE' },
          { unitNumber: '507', sqft: 976, sold: 'Sold', buyerName: 'Ashwini Pothula', unitType: 'MEDICAL' },
          { unitNumber: '508', sqft: 1052, sold: 'Sold', buyerName: 'Nagender Telkar', unitType: 'MEDICAL' },
          { unitNumber: '509', sqft: 1052, sold: 'Sold', businessName: 'Child Psychiatrist', buyerName: 'Adeep Kota', unitType: 'MEDICAL' },
          { unitNumber: '510', sqft: 1052, sold: 'Sold', buyerName: 'Praveen Reddy', unitType: 'MEDICAL' },
          { unitNumber: '511', sqft: 1052, sold: 'Sold', buyerName: 'Rahul Nadendla, Priyanka Namburu', unitType: 'MEDICAL' },
          { unitNumber: '512', sqft: 976, sold: 'Sold', businessName: 'Oral Surgeon', buyerName: 'Arjun R Ananthula', unitType: 'MEDICAL' },
          { unitNumber: '513', sqft: 976, sold: 'Sold', buyerName: 'Sravanthi Sanku', unitType: 'MEDICAL' },
          { unitNumber: '514', sqft: 905, sold: 'Sold', businessName: 'Oral Surgeon', buyerName: 'Sailaja Mahendrakar, Bharath Pissay', unitType: 'MEDICAL' },
          { unitNumber: '515', sqft: 905, sold: 'Sold', businessName: 'Kumon', buyerName: 'Suresh Veddamapula', unitType: 'RETAIL' },
          { unitNumber: '516', sqft: 2235, sold: 'Sold', businessName: 'Oral Surgeon', buyerName: 'Seshu Yalamanchili', unitType: 'MEDICAL' },
          { unitNumber: '517', sqft: 2235, sold: 'Sold', businessName: 'Med Spa', buyerName: 'NIKHIL KASHYAP', unitType: 'MEDICAL' },
        ],
      },
      {
        name: 'Building 6',
        units: [
          { unitNumber: '600', sqft: 10000, sold: 'Sold', businessName: 'TLE', unitType: 'RETAIL' },
        ],
      },
      {
        name: 'Building 7',
        units: [
          { unitNumber: '700', sqft: 1477, leased: 'Leased', businessName: 'Manyavar', unitType: 'RETAIL' },
          { unitNumber: '701', sqft: 1573, unitType: 'RETAIL' },
          { unitNumber: '702', sqft: 1804, leased: 'Leased', businessName: 'Seven Oaks', unitType: 'RETAIL' },
        ],
      },
      {
        name: 'Building 8',
        units: [
          { unitNumber: '800', sqft: 1174, sold: 'Sold', leased: 'Leased', businessName: 'PURE GREEN', buyerName: 'Ramesh Murugesan', unitType: 'RETAIL' },
          { unitNumber: '801', sqft: 1500, businessName: 'DUMPLINGS', unitType: 'RESTAURANT' },
          { unitNumber: '802', sqft: 1817, businessName: 'SHIPLEY DONUTS', unitType: 'RESTAURANT' },
        ],
      },
    ],
  },

  // ---- 6. RRC Phase 2 ----
  {
    name: 'RRC Phase 2',
    slug: 'rrc-phase-2',
    location: 'Texas',
    phase: 'LEASE_UP',
    status: 'ACTIVE',
    buildings: [
      {
        name: 'Building 9',
        units: [
          { unitNumber: '901', sqft: 4301, leased: 'Leased', businessName: 'Malabar', unitType: 'RETAIL' },
          { unitNumber: '902', sqft: 2495, businessName: 'Bagel Brigade', unitType: 'RETAIL' },
        ],
      },
      {
        name: 'Building 10',
        units: [
          { unitNumber: '1001', sqft: 3033, leased: 'Leased', businessName: 'Athidhi Restaurant', unitType: 'RESTAURANT' },
          { unitNumber: '1002', sqft: 2466, unitType: 'RETAIL' },
        ],
      },
      {
        name: 'Building 11',
        units: [
          { unitNumber: '1101', sqft: 1618, leased: 'Leased', businessName: 'FION LIQUOR STORE', unitType: 'RETAIL' },
          { unitNumber: '1102', sqft: 1216, sold: 'Sold', buyerName: 'Mythili Kasturi', unitType: 'RETAIL' },
          { unitNumber: '1103', sqft: 1262, sold: 'Sold', buyerName: 'Mythili Kasturi', unitType: 'RETAIL' },
          { unitNumber: '1104', sqft: 1337, sold: 'Sold', buyerName: 'Chandra Shekar Punna', unitType: 'RETAIL' },
          { unitNumber: '1105', sqft: 1410, sold: 'Sold', businessName: 'RED CHILLI', buyerName: 'Chandra Shekar Punna', unitType: 'RESTAURANT' },
          { unitNumber: '1106', sqft: 1261, sold: 'Sold', buyerName: 'Bhagya Lakshmi Singupurapu', unitType: 'RETAIL' },
          { unitNumber: '1107', sqft: 1338, sold: 'Sold', buyerName: 'Sharath Neela', unitType: 'RETAIL' },
          { unitNumber: '1108', sqft: 1968, leased: 'Leased', businessName: 'Smoke Shop', unitType: 'RETAIL' },
          { unitNumber: '1109', sqft: 1618, unitType: 'RETAIL' },
          { unitNumber: '1110', sqft: 1216, sold: 'Sold', buyerName: 'Pardha Saradhi', unitType: 'RETAIL' },
          { unitNumber: '1111', sqft: 1262, sold: 'Sold', businessName: "Neha's Salon and Spa", buyerName: 'Neha', unitType: 'RETAIL' },
          { unitNumber: '1112', sqft: 1337, sold: 'Sold', buyerName: 'Swetha Rao Yadagiri', unitType: 'RETAIL' },
          { unitNumber: '1113', sqft: 1410, sold: 'Sold', buyerName: 'Ram Varma', unitType: 'RETAIL' },
          { unitNumber: '1114', sqft: 1261, sold: 'Sold', buyerName: 'Susheela Chintakindi', unitType: 'RETAIL' },
          { unitNumber: '1115', sqft: 1338, sold: 'Sold', buyerName: 'Rajagopal Purushotham', unitType: 'RETAIL' },
          { unitNumber: '1116', sqft: 2109, unitType: 'RETAIL' },
        ],
      },
      {
        name: 'Building 12',
        units: [
          { unitNumber: '1201', sqft: 1927, leased: 'Leased', businessName: 'SRISHTI ELITE', unitType: 'RETAIL' },
          { unitNumber: '1202', sqft: 1338, sold: 'Sold', buyerName: 'Prabhat Nadimpalli', unitType: 'RETAIL' },
          { unitNumber: '1203', sqft: 1261, sold: 'Sold', buyerName: 'Prabhat Nadimpalli', unitType: 'RETAIL' },
          { unitNumber: '1204', sqft: 1410, sold: 'Sold', buyerName: 'Hari Hara Kumar Earlapati', unitType: 'RETAIL' },
          { unitNumber: '1205', sqft: 1337, sold: 'Sold', businessName: 'New Sitara Indian Cuisine & Bar', buyerName: 'Hari Hara Kumar Earlapati', unitType: 'RESTAURANT' },
          { unitNumber: '1206', sqft: 1262, sold: 'Sold', buyerName: 'Sathish Kumar Bikumalla', unitType: 'RETAIL' },
          { unitNumber: '1207', sqft: 1216, sold: 'Sold', buyerName: 'Anand Tirumala', unitType: 'RETAIL' },
          { unitNumber: '1208', sqft: 1618, sold: 'Sold', buyerName: 'Bhanu Prasad Mudhunuri', unitType: 'RETAIL' },
          { unitNumber: '1209', sqft: 2067, unitType: 'RETAIL' },
          { unitNumber: '1210', sqft: 1338, sold: 'Sold', buyerName: 'Balaji Naidu Gudi', unitType: 'RETAIL' },
          { unitNumber: '1211', sqft: 1261, sold: 'Sold', buyerName: 'Suresh Lingineni', unitType: 'RETAIL' },
          { unitNumber: '1212', sqft: 1410, sold: 'Unsold', unitType: 'RETAIL' },
          { unitNumber: '1213', sqft: 1337, sold: 'Sold', buyerName: 'Ramahanumanthu Mallireddy', unitType: 'RETAIL' },
          { unitNumber: '1214', sqft: 1262, sold: 'Sold', buyerName: 'Ravi Kiran Yeda', unitType: 'RETAIL' },
          { unitNumber: '1215', sqft: 1216, sold: 'Sold', buyerName: 'Jyothsna Kamuni', unitType: 'RETAIL' },
          { unitNumber: '1216', sqft: 1618, unitType: 'RETAIL' },
        ],
      },
    ],
  },

  // ---- 7. Spur Plaza ----
  {
    name: 'Spur Plaza',
    slug: 'spur-plaza',
    location: 'Texas',
    phase: 'PRE_DEVELOPMENT',
    status: 'ACTIVE',
    buildings: [
      {
        name: 'Building 1',
        units: [
          { unitNumber: '101', sqft: 2550, unitType: 'RETAIL' },
          { unitNumber: '102', sqft: 2550, unitType: 'RETAIL' },
          { unitNumber: '103', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '105', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '106', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '107', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '108', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '109', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '110', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '111', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '112', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '113', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '114', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '115', sqft: 2550, unitType: 'RETAIL' },
          { unitNumber: '116', sqft: 2488, unitType: 'RETAIL' },
        ],
      },
      {
        name: 'Building 2',
        units: [
          { unitNumber: '201', sqft: 2550, unitType: 'RETAIL' },
          { unitNumber: '202', sqft: 2550, unitType: 'RETAIL' },
          { unitNumber: '203', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '204', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '205', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '206', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '207', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '208', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '209', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '210', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '211', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '212', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '213', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '214', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '215', sqft: 2550, unitType: 'RETAIL' },
          { unitNumber: '216', sqft: 2488, unitType: 'RETAIL' },
        ],
      },
      {
        name: 'Building 3',
        units: [
          { unitNumber: '301', sqft: 2550, unitType: 'RETAIL' },
          { unitNumber: '302', sqft: 2488, unitType: 'RETAIL' },
          { unitNumber: '303', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '304', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '305', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '306', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '307', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '308', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '309', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '310', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '311', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '312', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '313', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '314', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '315', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '316', sqft: 3228, unitType: 'RETAIL' },
          { unitNumber: '317', sqft: 2835, unitType: 'RETAIL' },
        ],
      },
      {
        name: 'Building 4',
        units: [
          { unitNumber: '401', sqft: 3056, unitType: 'RETAIL' },
          { unitNumber: '402', sqft: 3456, unitType: 'RETAIL' },
          { unitNumber: '403', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '404', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '405', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '406', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '407', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '408', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '409', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '410', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '411', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '412', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '413', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '414', sqft: 2488, unitType: 'RETAIL' },
          { unitNumber: '415', sqft: 2550, unitType: 'RETAIL' },
        ],
      },
      {
        name: 'Building 5',
        units: [
          { unitNumber: '501', sqft: 2550, unitType: 'RETAIL' },
          { unitNumber: '502', sqft: 2488, unitType: 'RETAIL' },
          { unitNumber: '503', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '504', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '505', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '506', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '507', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '508', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '509', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '510', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '511', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '512', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '513', sqft: 1650, unitType: 'RETAIL' },
          { unitNumber: '514', sqft: 3456, unitType: 'RETAIL' },
          { unitNumber: '515', sqft: 3056, unitType: 'RETAIL' },
        ],
      },
      {
        name: 'Building 6',
        units: [
          { unitNumber: '600', sqft: null, unitType: 'RESIDENTIAL_LOT' },
          { unitNumber: '602', sqft: null, unitType: 'RESIDENTIAL_LOT' },
          { unitNumber: '604', sqft: null, unitType: 'RESIDENTIAL_LOT' },
          { unitNumber: '606', sqft: null, unitType: 'RESIDENTIAL_LOT' },
          { unitNumber: '608', sqft: null, unitType: 'RESIDENTIAL_LOT' },
          { unitNumber: '610', sqft: null, unitType: 'RESIDENTIAL_LOT' },
          { unitNumber: '612', sqft: null, unitType: 'RESIDENTIAL_LOT' },
          { unitNumber: '614', sqft: null, unitType: 'RESIDENTIAL_LOT' },
          { unitNumber: '616', sqft: null, unitType: 'RESIDENTIAL_LOT' },
          { unitNumber: '618', sqft: null, unitType: 'RESIDENTIAL_LOT' },
        ],
      },
    ],
  },
];

// ============================================================
// MAIN SEED FUNCTION
// ============================================================

async function main() {
  console.log('🌱 Seeding Prime Tracker database...');

  // ---- Demo Users (hardcoded IDs matching jwt-auth.guard demo bypass) ----
  const demoUsers = [
    { id: 'demo-user-super_admin', email: 'demo-super_admin@primedevelopers.com', name: 'Demo Super Admin', role: 'SUPER_ADMIN' as const },
    { id: 'demo-user-founder', email: 'demo-founder@primedevelopers.com', name: 'Demo Founder', role: 'FOUNDER' as const },
    { id: 'demo-user-executive', email: 'demo-executive@primedevelopers.com', name: 'Demo Executive', role: 'EXECUTIVE' as const },
    { id: 'demo-user-finance', email: 'demo-finance@primedevelopers.com', name: 'Demo Finance', role: 'FINANCE' as const },
    { id: 'demo-user-accounting', email: 'demo-accounting@primedevelopers.com', name: 'Demo Accounting', role: 'ACCOUNTING' as const },
    { id: 'demo-user-ar_ap', email: 'demo-ar_ap@primedevelopers.com', name: 'Demo AR/AP', role: 'AR_AP' as const },
    { id: 'demo-user-project_manager', email: 'demo-project_manager@primedevelopers.com', name: 'Demo PM', role: 'PROJECT_MANAGER' as const },
    { id: 'demo-user-construction', email: 'demo-construction@primedevelopers.com', name: 'Demo Construction', role: 'CONSTRUCTION' as const },
    { id: 'demo-user-sales', email: 'demo-sales@primedevelopers.com', name: 'Demo Sales', role: 'SALES' as const },
    { id: 'demo-user-marketing', email: 'demo-marketing@primedevelopers.com', name: 'Demo Marketing', role: 'MARKETING' as const },
    { id: 'demo-user-legal', email: 'demo-legal@primedevelopers.com', name: 'Demo Legal', role: 'LEGAL' as const },
    { id: 'demo-user-viewer', email: 'demo-viewer@primedevelopers.com', name: 'Demo Viewer', role: 'VIEWER' as const },
  ];
  for (const du of demoUsers) {
    await prisma.user.upsert({
      where: { email: du.email },
      update: {},
      create: { id: du.id, email: du.email, name: du.name, role: du.role, isActive: true },
    });
  }

  // ---- Users ----
  const founder = await prisma.user.upsert({
    where: { email: 'mallik@primedevelopers.com' },
    update: {},
    create: {
      email: 'mallik@primedevelopers.com',
      name: 'Mallik Gilakattula',
      role: 'FOUNDER',
      isActive: true,
    },
  });

  const financeUser = await prisma.user.upsert({
    where: { email: 'finance@primedevelopers.com' },
    update: {},
    create: {
      email: 'finance@primedevelopers.com',
      name: 'Sarah Chen',
      role: 'FINANCE',
      isActive: true,
    },
  });

  const pmUser = await prisma.user.upsert({
    where: { email: 'pm@primedevelopers.com' },
    update: {},
    create: {
      email: 'pm@primedevelopers.com',
      name: 'James Rivera',
      role: 'PROJECT_MANAGER',
      isActive: true,
    },
  });

  const salesUser = await prisma.user.upsert({
    where: { email: 'sales@primedevelopers.com' },
    update: {},
    create: {
      email: 'sales@primedevelopers.com',
      name: 'Emily Park',
      role: 'SALES',
      isActive: true,
    },
  });

  // ---- Wipe financial + comment data so buildings can be safely re-created ----
  console.log('\n🧹 Cleaning financial & unit data...');
  await prisma.sale.deleteMany();
  await prisma.lease.deleteMany();
  await prisma.drawRequest.deleteMany();
  await prisma.loan.deleteMany();
  await prisma.actual.deleteMany();
  await prisma.commitment.deleteMany();
  await prisma.budgetLine.deleteMany();
  await prisma.unitComment.deleteMany();
  await prisma.projectComment.deleteMany();

  // ---- Create Projects, Buildings & Units ----
  let totalUnits = 0;
  const createdProjectIds: string[] = [];

  for (const proj of projects) {
    console.log(`\n📦 Creating project: ${proj.name}`);

    const project = await prisma.project.upsert({
      where: { slug: proj.slug },
      update: {},
      create: {
        name: proj.name,
        slug: proj.slug,
        location: proj.location,
        status: proj.status,
        phase: proj.phase,
        description: `${proj.name} - ${proj.location}`,
      },
    });
    createdProjectIds.push(project.id);

    // Delete existing buildings (cascades to units, leases, sales, comments)
    await prisma.building.deleteMany({ where: { projectId: project.id } });

    for (const bldg of proj.buildings) {
      const totalSqft = bldg.units.reduce((sum, u) => sum + (u.sqft || 0), 0);

      const building = await prisma.building.create({
        data: {
          projectId: project.id,
          name: bldg.name,
          totalSqft: totalSqft || null,
          stories: 1,
          buildingType: bldg.units[0]?.unitType === 'FLEX' ? 'INDUSTRIAL' : 'RETAIL',
        },
      });

      // Create units in batches
      const unitCreateData = bldg.units.map((u) => {
        const status = mapUnitStatus(u.sold, u.leased);
        // $450 PSF for all units
        const askingPrice = u.sqft ? Math.round(u.sqft * 450) : null;

        // Build notes from business name and buyer
        const noteParts: string[] = [];
        if (u.businessName) noteParts.push(`Business: ${u.businessName}`);
        if (u.buyerName) noteParts.push(`Buyer: ${u.buyerName}`);

        return {
          buildingId: building.id,
          unitNumber: u.unitNumber,
          unitType: u.unitType || 'RETAIL' as const,
          sqft: u.sqft,
          status,
          askingPrice: askingPrice,
          notes: noteParts.length > 0 ? noteParts.join(' | ') : null,
        };
      });

      await prisma.unit.createMany({ data: unitCreateData });
      totalUnits += unitCreateData.length;

      console.log(`   🏢 ${bldg.name}: ${unitCreateData.length} units`);
    }
  }

  // ---- Project memberships ----
  // Field roles (PM/Construction/Sales/Marketing) only see projects they're assigned to.
  // For seed/demo, enrol every field-role user into every project so the app stays usable.
  const fieldUsers = await prisma.user.findMany({
    where: { role: { in: ['PROJECT_MANAGER', 'CONSTRUCTION', 'SALES', 'MARKETING'] } },
    select: { id: true },
  });
  if (fieldUsers.length && createdProjectIds.length) {
    await prisma.projectMember.createMany({
      data: createdProjectIds.flatMap((projectId) =>
        fieldUsers.map((u) => ({ projectId, userId: u.id, role: 'TEAM_MEMBER' })),
      ),
      skipDuplicates: true,
    });
    console.log(`   🔐 Enrolled ${fieldUsers.length} field users into ${createdProjectIds.length} projects`);
  }

  console.log('\n✅ Seed complete!');
  console.log(`   👤 Users: ${founder.name}, ${financeUser.name}, ${pmUser.name}, ${salesUser.name}`);
  console.log(`   📦 Projects: ${projects.length}`);
  console.log(`   🏠 Total units: ${totalUnits}`);
}

main()
  .catch((e) => {
    console.error('Seed error:', e);
    process.exit(1);
  })
  .finally(async () => {
    await prisma.$disconnect();
  });
