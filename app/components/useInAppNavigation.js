import { useCallback } from "react";
import { useLocation, useNavigate } from "react-router";

const SHOPIFY_CONTEXT_PARAMS = ["shop", "host", "embedded"];

function mergeSearchParams(currentSearch = "", nextSearch = "") {
  const current = new URLSearchParams(currentSearch.startsWith("?") ? currentSearch.slice(1) : currentSearch);
  const next = new URLSearchParams(nextSearch.startsWith("?") ? nextSearch.slice(1) : nextSearch);

  SHOPIFY_CONTEXT_PARAMS.forEach((key) => {
    const value = current.get(key);
    if (value && !next.has(key)) next.set(key, value);
  });

  const query = next.toString();
  return query ? `?${query}` : "";
}

export function useInAppNavigation() {
  const location = useLocation();
  const navigate = useNavigate();

  const appHref = useCallback(
    (pathname, search = "") => `${pathname}${mergeSearchParams(location.search, search)}`,
    [location.search],
  );

  const navigateInApp = useCallback(
    (pathname, search = "") => {
      navigate({ pathname, search: mergeSearchParams(location.search, search) });
    },
    [location.search, navigate],
  );

  return { appHref, navigateInApp };
}
