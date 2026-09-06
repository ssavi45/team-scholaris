import { Link } from 'react-router'
import { AuthLayout } from './AuthLayout'

export function AuthCallbackPage() {
  return <AuthLayout title="Authentication isn’t connected yet" description="This link cannot complete sign-in in the current frontend preview.">
    <p className="form-note">Account verification and sign-in callbacks will be available after the Supabase integration is configured.</p>
    <Link to="/login">Back to sign in</Link>
  </AuthLayout>
}
