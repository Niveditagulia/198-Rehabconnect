import {getUser} from '../../lib/auth';
import {redirect} from 'next/navigation';
import Dashboard from '../dashboard';
export const dynamic = 'force-dynamic';
export default async function Physiotherapist() {
  const user = await getUser();
  if (!user) redirect('/login');
  if (user.role !== 'physiotherapist') redirect('/patient');
  return <Dashboard role="physiotherapist"/>;
}
