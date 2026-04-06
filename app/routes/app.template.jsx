import { Badge, BlockStack, Card, Layout, Page, Text, TextField } from "@shopify/polaris";
import {
  buildBlogContentPrompt,
  buildCollectionContentPrompt,
  buildPageContentPrompt,
  buildProductContentPrompt,
} from "../lib/contentPromptTemplates";

const productPromptTemplate = buildProductContentPrompt({
  title: "{{product_title}}",
  descriptionText: "{{current_product_description}}",
  seoTitle: "{{current_meta_title}}",
  seoDescription: "{{current_meta_description}}",
  language: "{{language}}",
  tone: "{{tone}}",
  lengthOption: "100 - 200 words",
  format: "{{format}}",
  contextKeywords: "{{keywords_or_context}}",
  intent: "all",
});

const collectionPromptTemplate = buildCollectionContentPrompt({
  title: "{{collection_title}}",
  descriptionText: "{{current_collection_description}}",
  seoTitle: "{{current_meta_title}}",
  seoDescription: "{{current_meta_description}}",
  language: "{{language}}",
  tone: "{{tone}}",
  lengthOption: "100 - 200 words",
  format: "{{format}}",
  contextKeywords: "{{keywords_or_context}}",
  intent: "all",
});

const pagePromptTemplate = buildPageContentPrompt({
  pageTitle: "{{page_title}}",
  pageType: "{{page_type}}",
  body: "{{existing_page_html_content}}",
  language: "{{language}}",
  tone: "{{tone}}",
  length: "{{length_preference}}",
  format: "{{format_preference}}",
  contextKeywords: "{{keywords_or_context}}",
});

const blogPromptTemplate = buildBlogContentPrompt({
  articleType: "{{article_type}}",
  title: "{{article_topic_or_title}}",
  body: "{{existing_article_html_content}}",
  language: "{{language}}",
  tone: "{{tone}}",
  length: "{{length_preference}}",
  format: "{{format_preference}}",
  contextKeywords: "{{keywords_or_context}}",
});

const productOutputTemplate = `{
  "productDescription": "<specific product description>",
  "seoTitle": "<specific product meta title>",
  "seoDescription": "<specific product meta description>"
}`;

const collectionOutputTemplate = `{
  "collectionDescription": "<specific collection description>",
  "seoTitle": "<specific collection meta title>",
  "seoDescription": "<specific collection meta description>"
}`;

const pageOutputTemplate = `{
  "pageBody": "<specific page body HTML>",
  "seoTitle": "<specific page meta title>",
  "seoDescription": "<specific page meta description>"
}`;

const blogOutputTemplate = `{
  "articleTitle": "<specific article title>",
  "articleBody": "<specific article body HTML>",
  "excerpt": "<specific article excerpt>",
  "seoTitle": "<specific blog meta title>",
  "seoDescription": "<specific blog meta description>"
}`;

function TemplateCard({ title, tags, promptTemplate, outputTemplate }) {
  return (
    <Card>
      <BlockStack gap="400">
        <BlockStack gap="200">
          <Text as="h2" variant="headingMd">
            {title}
          </Text>
          <BlockStack gap="100">
            <Text as="p" variant="bodySm" tone="subdued">
              Specific content template for Shopify AI generation.
            </Text>
            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
              {tags.map((tag) => (
                <Badge key={tag}>{tag}</Badge>
              ))}
            </div>
          </BlockStack>
        </BlockStack>

        <TextField
          label="Prompt Template"
          value={promptTemplate}
          multiline={14}
          readOnly
          autoComplete="off"
        />

        <TextField
          label="Expected JSON Output Template"
          value={outputTemplate}
          multiline={8}
          readOnly
          autoComplete="off"
        />
      </BlockStack>
    </Card>
  );
}

export default function TemplatePage() {
  return (
    <Page
      title="Template"
      subtitle="Prompt templates for Products, Collections, Pages, and Blogs with specific SEO/meta fields."
    >
      <Layout>
        <Layout.Section>
          <Card>
            <BlockStack gap="200">
              <Text as="h1" variant="headingLg">
                Content Generate Prompt Templates
              </Text>
              <Text as="p" tone="subdued">
                Use these templates to generate specific content including meta title, meta description,
                description/body content, and HTML output where required.
              </Text>
            </BlockStack>
          </Card>
        </Layout.Section>

        <Layout.Section>
          <TemplateCard
            title="Products Prompt Template"
            tags={["Meta Title", "Meta Description", "Description"]}
            promptTemplate={productPromptTemplate}
            outputTemplate={productOutputTemplate}
          />
        </Layout.Section>

        <Layout.Section>
          <TemplateCard
            title="Collections Prompt Template"
            tags={["Meta Title", "Meta Description", "Description"]}
            promptTemplate={collectionPromptTemplate}
            outputTemplate={collectionOutputTemplate}
          />
        </Layout.Section>

        <Layout.Section>
          <TemplateCard
            title="Pages Prompt Template"
            tags={["Meta Title", "Meta Description", "Body Content (HTML)"]}
            promptTemplate={pagePromptTemplate}
            outputTemplate={pageOutputTemplate}
          />
        </Layout.Section>

        <Layout.Section>
          <TemplateCard
            title="Blogs Prompt Template"
            tags={["Meta Title", "Meta Description", "Article Body (HTML)"]}
            promptTemplate={blogPromptTemplate}
            outputTemplate={blogOutputTemplate}
          />
        </Layout.Section>
      </Layout>
    </Page>
  );
}
