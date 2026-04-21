import { redirect } from "react-router";

export const loader = async () => {
  throw redirect("/app");
};

export const action = async () => {
  throw redirect("/app");
};

export default function BlogPageRemoved() {
  return null;
}
