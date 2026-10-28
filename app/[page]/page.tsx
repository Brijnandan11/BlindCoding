import Experience from "@/components/Experience";
import { notFound } from "next/navigation";
export default async function Page({ params }: { params: Promise<{ page: string }> }) {
  const { page } = await params;
  if (
    !["login", "instructions", "contest", "result", "leaderboard", "admin", "rules"].includes(page)
  )
    notFound();
  return <Experience page={page} />;
}
