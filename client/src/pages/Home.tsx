import { trpc } from "../trpc"

export default function Home() {
    const { data, isLoading } = trpc.healthcheck.useQuery()
    if (isLoading) return <div>Loading...</div>
    return (
        <div>
            <h1>Home Page</h1>
            <div>{data?.status} — {data?.timestamp}</div>
        </div>
    )
}