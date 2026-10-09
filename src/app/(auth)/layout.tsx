import { PhoneFrame, ToastProvider } from "@/components/ui";

export default function AuthLayout({ children }: { children: React.ReactNode }) {
  return (
    <ToastProvider>
      <PhoneFrame>{children}</PhoneFrame>
    </ToastProvider>
  );
}
