import type { Metadata } from "next";

import { SignInScreen } from "../../features/auth/sign-in-screen";

export const metadata: Metadata = {
  title: "Local fixture sign in",
};

export default function SignInPage() {
  return <SignInScreen />;
}
