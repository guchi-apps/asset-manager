"use client"

import { useRouter } from "next/navigation"

import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select"

export function FurusatoYearPicker({ years, selectedYear }: { years: number[]; selectedYear: number }) {
    const router = useRouter()
    return (
        <Select value={String(selectedYear)} onValueChange={(year) => router.push(`/furusato?year=${year}`)}>
            <SelectTrigger aria-label="対象年" className="w-28">
                <SelectValue />
            </SelectTrigger>
            <SelectContent>
                {years.map((year) => (
                    <SelectItem key={year} value={String(year)}>
                        {year}年
                    </SelectItem>
                ))}
            </SelectContent>
        </Select>
    )
}
