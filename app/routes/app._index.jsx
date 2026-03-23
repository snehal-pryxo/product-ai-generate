import { boundary } from "@shopify/shopify-app-react-router/server";
import { authenticate } from "../shopify.server";
import styles from "../styles/app-home.module.css";

export const loader = async ({ request }) => {
  await authenticate.admin(request);
  return null;
};

const cardItems = [
  { id: "product", title: "Product Descriptions", icon: "product", active: true },
  { id: "blog", title: "Generate Blog Posts", icon: "blog", active: true },
  {
    id: "collection",
    title: "Collection Descriptions",
    icon: "collection",
    active: true,
  },
  { id: "seo", title: "Optimize Page SEO", icon: "seo", active: true },
];

const cardIcons = {
  product: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 6.5h6v3H4v-3Zm0 4.5h16v2H4v-2Zm0 3.5h16v2H4v-2Zm8-8.5h8v3h-8v-3Z" />
    </svg>
  ),
  blog: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M7 5.5h8.5a4.5 4.5 0 0 1 0 9H10v3.5a1.5 1.5 0 0 1-3 0V7A1.5 1.5 0 0 1 7 5.5Zm3 3v3h5.5a1.5 1.5 0 0 0 0-3H10Z" />
    </svg>
  ),
  collection: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M4 13h6v7H4v-7Zm5-9h11v11H9V4Zm-5 2h3v3H4V6Zm9 2h5v2h-5V8Z" />
    </svg>
  ),
  seo: (
    <svg viewBox="0 0 24 24" aria-hidden="true">
      <path d="M12 4a8 8 0 1 1 0 16 8 8 0 0 1 0-16Zm0 3a5 5 0 1 0 0 10 5 5 0 0 0 0-10Zm0 2.5A2.5 2.5 0 1 1 9.5 12 2.5 2.5 0 0 1 12 9.5Z" />
    </svg>
  ),
};

export default function Index() {
  return (
    <main className={styles.page}>
      <section className={styles.panel}>
        <header className={styles.hero}>
          <h1 className={styles.title}>Proxy AI Content Generator!</h1>
          <p className={styles.subtitle}>
            Generate high-quality, AI-Optimized content in seconds
          </p>
        </header>

        <div className={styles.separator} />

        <div className={styles.grid}>
          {cardItems.map((item, index) => (
            <article
              key={item.id}
              className={styles.card}
              style={{ "--card-delay": `${index * 75}ms` }}
            >
              <div className={styles.cardInfo}>
                <div className={styles.iconWrap}>{cardIcons[item.icon]}</div>
                <h2 className={styles.cardTitle}>{item.title}</h2>
              </div>

              {item.active ? (
                <button type="button" className={styles.generateButton}>
                  Generate
                </button>
              ) : (
                <span className={styles.comingSoon}>o Comming soon</span>
              )}
            </article>
          ))}
        </div>
      </section>
    </main>
  );
}

export const headers = (headersArgs) => {
  return boundary.headers(headersArgs);
};
