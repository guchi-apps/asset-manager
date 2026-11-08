import { redirect } from "next/navigation"

// 賞与の一覧は給与と統合した /salaries へ移した（Issue #1182）。ブックマーク・旧リンクのために残す
export default function BonusesPage() {
    redirect("/salaries")
}
