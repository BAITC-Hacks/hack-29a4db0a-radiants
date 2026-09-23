import AuthBoundary from "@/components/AuthBoundary";
export const dynamic = "force-dynamic";
export default function Home() { return <AuthBoundary demoLoginEnabled={process.env.DEMO_EMPLOYEE_LOGIN === "true"} />; }
