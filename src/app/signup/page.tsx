import AuthForm from "@/components/AuthForm";
import { signupAction } from "@/lib/actions/auth";

export default function SignupPage() {
  return (
    <AuthForm
      title="Create your account"
      action={signupAction}
      fields={[
        { name: "name", label: "Your name" },
        { name: "workspace", label: "Workspace name", placeholder: "Acme Outbound" },
        { name: "email", label: "Email", type: "email" },
        { name: "password", label: "Password (8+ characters)", type: "password" },
      ]}
      submitLabel="Create account"
      footer={{ text: "Already have an account?", linkText: "Log in", href: "/login" }}
    />
  );
}
