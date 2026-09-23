import { Compass } from "lucide-react";
import type { EmployeeView } from "../types/career";

export function NoNextStepState({ view }: { view: EmployeeView }) {
  return <section className="no-recs" aria-label="No next step">
    <span className="empty-icon"><Compass size={21} /></span>
    <h3>No suitable next step is currently available.</h3>
    {view.targetStatus === "needs_career_goal" && <p>Set a career goal to see development steps for a target role.</p>}
  </section>;
}
