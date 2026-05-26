import { redirect } from "next/navigation";
import { createSessionClient } from "@/lib/supabase/server";
import LawForm from "./_components/LawForm";

export default async function NewLawPage() {
  const supabase = await createSessionClient();
  const { data: { user } } = await supabase.auth.getUser();
  if (!user) redirect("/auth/login");

  return (
    <main className="min-h-screen bg-stone-50">
      <div className="max-w-xl mx-auto px-4 py-10">
        <h1 className="text-2xl font-bold text-stone-800 mb-6">法律を作る</h1>
        <LawForm />
      </div>
    </main>
  );
}
