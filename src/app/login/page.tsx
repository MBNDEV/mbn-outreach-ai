import AuthForm from "@/components/AuthForm";
import { loginAction } from "@/lib/actions/auth";

export default function LoginPage() {
  return (
    <AuthForm
      title="Log in"
      action={loginAction}
      fields={[
        { name: "email", label: "Email", type: "email" },
        { name: "password", label: "Password", type: "password" },
      ]}
      submitLabel="Log in"
      footer={{ text: "No account yet?", linkText: "Sign up", href: "/signup" }}
    />
  );
}
