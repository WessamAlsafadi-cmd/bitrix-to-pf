import express from "express";
import axios from "axios";

const app = express();

// Parse both JSON and URL-encoded payloads
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

const BITRIX_BASE = "https://tlre.bitrix24.com/rest/17/q49rh3i333ywswgp";

// Get CRM field definitions
async function getFieldDefinitions(entityTypeId) {
  const url = `${BITRIX_BASE}/crm.item.fields.json`;
  const res = await axios.post(url, { entityTypeId });
  return res.data.result;
}

// Get CRM item data
async function getItem(entityTypeId, itemId) {
  const url = `${BITRIX_BASE}/crm.item.get.json`;
  const res = await axios.post(url, { entityTypeId, id: itemId });
  return res.data.result.item;
}

// Transform item to use readable labels
function transformItem(item, fieldsMeta) {
  const output = {};
  for (const key in item) {
    const value = item[key];
    if (fieldsMeta[key]) {
      const meta = fieldsMeta[key];
      const label = meta.title || key;

      if (meta.type === "enumeration") {
        if (Array.isArray(value)) {
          output[label] = value.map(
            v => meta.items.find(opt => String(opt.ID) === String(v))?.VALUE || v
          );
        } else {
          output[label] = meta.items.find(opt => String(opt.ID) === String(value))?.VALUE || value;
        }
      } else {
        output[label] = value;
      }
    } else {
      output[key] = value;
    }
  }
  return output;
}

app.post("/webhook", async (req, res) => {
  try {
    console.log("Incoming webhook payload:", req.body);

    // Extract entityTypeId and itemId from document_id[2]
    const docId = req.body.document_id?.[2]; // e.g., "DYNAMIC_1036_5"
    if (!docId) return res.status(400).send("Missing document_id[2]");

    const parts = docId.split("_");
    const entityTypeId = parseInt(parts[1]);
    const itemId = parseInt(parts[2]);

    // Fetch fields and item
    const fieldsMeta = await getFieldDefinitions(entityTypeId);
    const item = await getItem(entityTypeId, itemId);

    // Transform for readable labels
    const cleanData = transformItem(item, fieldsMeta);

    console.log("Transformed item:", cleanData);

    res.json(cleanData);
  } catch (error) {
    console.error(error);
    res.status(500).send(error.toString());
  }
});

app.listen(3000, () => {
  console.log("Server running on port 3000");
});
