import { useNavigate } from "react-router-dom";
import { NotificationsView } from "@/views/notifications";

export function NotificationsPage() {
  const navigate = useNavigate();
  return <NotificationsView onBack={() => navigate("/chat")} />;
}
