import { useNavigate } from "react-router-dom";
import { DecisionReviewView } from "@/views/decision-review";

export function ReviewPage() {
  const navigate = useNavigate();
  return <DecisionReviewView onBack={() => navigate("/chat")} />;
}
