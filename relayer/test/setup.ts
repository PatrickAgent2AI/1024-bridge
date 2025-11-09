import dotenv from 'dotenv';

dotenv.config({ path: '.env.test' });

beforeAll(() => {
  console.log('Test suite starting...');
});

afterAll(() => {
  console.log('Test suite completed');
});

