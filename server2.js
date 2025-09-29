import express from "express";
import axios from "axios";

const app = express();
app.use(express.urlencoded({ extended: true }));
app.use(express.json());

const BITRIX_BASE = "https://tlre.bitrix24.com/rest/17/q49rh3i333ywswgp";
const PF_API_BASE = "https://atlas.propertyfinder.com/v1";

// PropertyFinder API credentials
const PF_API_KEY = "rOGIm.6M6zLMbGY8zdlvvR0U051rd9GiQ38syf5M";
const PF_API_SECRET = "Jakr0uO5J7zYYrPHWbhdbhZXzzAwZA62";

// Token cache
let pfAccessToken = null;
let pfTokenExpiresAt = null;

// Get PropertyFinder access token
async function getPropertyFinderToken() {
  // Return cached token if still valid
  if (pfAccessToken && pfTokenExpiresAt && new Date() < pfTokenExpiresAt) {
    return pfAccessToken;
  }

  try {
    const response = await axios.post(`${PF_API_BASE}/auth/token`, {
      apiKey: PF_API_KEY,
      apiSecret: PF_API_SECRET
    });

    pfAccessToken = response.data.accessToken;
    // Set expiration with 1 minute buffer
    pfTokenExpiresAt = new Date(Date.now() + (response.data.expiresIn - 60) * 1000);
    
    console.log("✅ PropertyFinder token obtained");
    return pfAccessToken;
  } catch (error) {
    console.error("❌ Failed to get PropertyFinder token:", error.response?.data || error.message);
    throw error;
  }
}

// Fetch field metadata from Bitrix
async function getFieldDefinitions(entityTypeId) {
  const url = `${BITRIX_BASE}/crm.item.fields.json`;
  const res = await axios.post(url, { entityTypeId });
  return res.data.result.fields;
}

// Fetch CRM item data from Bitrix
async function getItem(entityTypeId, itemId) {
  const url = `${BITRIX_BASE}/crm.item.get.json`;
  const res = await axios.post(url, { entityTypeId, id: itemId });
  return res.data.result.item;
}

// Transform raw Bitrix data into human-readable labels
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
      } else if (meta.type === "file") {
        if (Array.isArray(value)) {
          output[label] = value.map(f => f.url || f.urlMachine || f);
        } else {
          output[label] = value.url || value.urlMachine || value;
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

// Download file from Bitrix authenticated URL
async function downloadBitrixFile(bitrixUrl) {
  try {
    const response = await axios.get(bitrixUrl, {
      responseType: 'arraybuffer'
    });
    return {
      data: response.data,
      contentType: response.headers['content-type']
    };
  } catch (error) {
    console.error(`Failed to download file from ${bitrixUrl}:`, error.message);
    return null;
  }
}

// Upload file to PropertyFinder (if they have an upload endpoint)
async function uploadFileToPropertyFinder(fileData, contentType) {
  // NOTE: This is a placeholder - check PropertyFinder docs for actual upload endpoint
  // They might have a /media/upload or similar endpoint
  try {
    const token = await getPropertyFinderToken();
    
    const response = await axios.post(
      `${PF_API_BASE}/media/upload`, // Check actual endpoint
      fileData,
      {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": contentType
        }
      }
    );
    
    return response.data.url; // Returns public URL
  } catch (error) {
    console.error("Failed to upload to PropertyFinder:", error.message);
    return null;
  }
}

// Map Bitrix data to PropertyFinder format
async function mapToPropertyFinderPayload(bitrixData) {
  // Extract price type and amount
  const priceType = Array.isArray(bitrixData['price.type']) 
    ? bitrixData['price.type'][0] 
    : bitrixData['price.type'] || 'monthly';
  
  const priceAmount = bitrixData['price.amounts'] || 0;
  
  // Build base payload with required fields
  const payload = {
    category: bitrixData.category || "residential",
    type: bitrixData.type || "apartment",
    furnishingType: bitrixData.furnishingType || "unfurnished",
    bedrooms: String(bitrixData.bedrooms || "1"),
    reference: bitrixData['External ID'] || `BITRIX_${bitrixData.ID}`,
    uaeEmirate: (bitrixData.Emirate || "dubai").toLowerCase().replace(' ', '_'),
    size: parseInt(bitrixData.Size) || 1000,
    title: {
      en: bitrixData.Name || "Property Listing"
    },
    description: {
      en: bitrixData.description || bitrixData.Name || "Property listing from Bitrix"
    }
  };

  // Price structure - only include the amounts for the specific price type
  payload.price = {
    type: priceType,
    amounts: {}
  };
  
  // Set the amount for the specific price type
  payload.price.amounts[priceType] = parseInt(priceAmount);

  // Add downpayment for sale listings
  if (priceType === "sale" && bitrixData.downPayment) {
    payload.price.downpayment = parseInt(bitrixData.downPayment);
  }

  // Location - PropertyFinder requires location ID
  const locationMapping = {
    "Dubai": 1,
    "Abu Dhabi": 2,
    "Sharjah": 3,
    "Ajman": 4,
    "Ras Al Khaimah": 5,
    "Fujairah": 6,
    "Umm Al Quwain": 7
  };
  
  payload.location = {
    id: locationMapping[bitrixData.Location] || 1
  };

  // Media - Bitrix file URLs
  // PropertyFinder needs at least original.url, optionally with height/width
  if (bitrixData.Files && Array.isArray(bitrixData.Files) && bitrixData.Files.length > 0) {
    payload.media = {
      images: bitrixData.Files.map(url => ({
        original: { 
          url: url,
          // If you have dimensions from Bitrix, add them:
          // height: bitrixData.imageHeight || 0,
          // width: bitrixData.imageWidth || 0
        }
      }))
    };
    console.log(`📸 Added ${bitrixData.Files.length} images to payload`);
  } else if (bitrixData.Files) {
    // Single file
    payload.media = {
      images: [{
        original: { url: bitrixData.Files }
      }]
    };
    console.log(`📸 Added 1 image to payload`);
  } else {
    console.warn("⚠️ No images found in Bitrix data");
    // PropertyFinder might require at least one image - add a placeholder if needed
    // payload.media = {
    //   images: [{
    //     original: { url: "https://via.placeholder.com/800x600" }
    //   }]
    // };
  }

  // Bathrooms (required unless land/farm)
  if (payload.type !== "land" && payload.type !== "farm") {
    payload.bathrooms = String(bitrixData.bathrooms || "1");
  } else if (bitrixData.bathrooms) {
    payload.bathrooms = String(bitrixData.bathrooms);
  }

  // Compliance for Dubai/Abu Dhabi (required)
  const emirate = payload.uaeEmirate;
  if (emirate === "dubai" || emirate === "abu_dhabi") {
    payload.compliance = {
      listingAdvertisementNumber: bitrixData.listingAdvertisementNumber || 
                                   bitrixData.complianceNumber || 
                                   "PENDING",
      type: bitrixData.complianceType || "rera"
    };
    
    // Optional compliance fields
    if (bitrixData.advertisementLicenseIssuanceDate) {
      payload.compliance.advertisementLicenseIssuanceDate = bitrixData.advertisementLicenseIssuanceDate;
    }
    if (bitrixData.issuingClientLicenseNumber) {
      payload.compliance.issuingClientLicenseNumber = bitrixData.issuingClientLicenseNumber;
    }
    
    console.log(`🏛️ Added compliance for ${emirate}`);
  }

  // Parking space for co-working-space (required)
  if (payload.type === "co-working-space") {
    payload.hasParkingSpace = bitrixData.hasParkingSpace === true || 
                               bitrixData.hasParkingSpace === "Y";
  }

  // Optional date fields
  if (bitrixData.availableFrom || bitrixData['Started on']) {
    // Convert to YYYY-MM-DD format
    const dateStr = bitrixData.availableFrom || bitrixData['Started on'];
    payload.availableFrom = dateStr.split('T')[0]; // Extract date part
  }

  // Optional numeric fields
  if (bitrixData.age) payload.age = parseInt(bitrixData.age);
  if (bitrixData.floorNumber) payload.floorNumber = String(bitrixData.floorNumber);
  if (bitrixData.parkingSlots) payload.parkingSlots = parseInt(bitrixData.parkingSlots);
  if (bitrixData.numberOfFloors) payload.numberOfFloors = parseInt(bitrixData.numberOfFloors);
  if (bitrixData.plotSize) payload.plotSize = parseInt(bitrixData.plotSize);

  // Optional string fields
  if (bitrixData.finishingType) payload.finishingType = bitrixData.finishingType;
  if (bitrixData.projectStatus) payload.projectStatus = bitrixData.projectStatus;
  if (bitrixData.developer) payload.developer = bitrixData.developer;
  if (bitrixData.unitNumber) payload.unitNumber = bitrixData.unitNumber;
  if (bitrixData.plotNumber) payload.plotNumber = bitrixData.plotNumber;
  if (bitrixData.landNumber) payload.landNumber = bitrixData.landNumber;
  if (bitrixData.ownerName) payload.ownerName = bitrixData.ownerName;
  
  // Optional boolean fields
  if (bitrixData.hasGarden !== undefined) {
    payload.hasGarden = bitrixData.hasGarden === true || bitrixData.hasGarden === "Y";
  }
  if (bitrixData.hasKitchen !== undefined) {
    payload.hasKitchen = bitrixData.hasKitchen === true || bitrixData.hasKitchen === "Y";
  }
  if (bitrixData.hasParkingOnSite !== undefined) {
    payload.hasParkingOnSite = bitrixData.hasParkingOnSite === true || bitrixData.hasParkingOnSite === "Y";
  }

  // Amenities array
  if (bitrixData.amenities && Array.isArray(bitrixData.amenities)) {
    payload.amenities = bitrixData.amenities;
  }

  // Assigned user
  if (bitrixData['Responsible person']) {
    payload.assignedTo = {
      id: parseInt(bitrixData['Responsible person'])
    };
  }

  return payload;
}

// Create listing on PropertyFinder
async function createPropertyFinderListing(payload) {
  try {
    const token = await getPropertyFinderToken();
    
    const response = await axios.post(
      `${PF_API_BASE}/listings`,
      payload,
      {
        headers: {
          "Authorization": `Bearer ${token}`,
          "Content-Type": "application/json"
        }
      }
    );

    return { success: true, data: response.data };
  } catch (error) {
    console.error("❌ PropertyFinder API Error:", error.response?.data || error.message);
    return {
      success: false,
      error: error.response?.data || error.message
    };
  }
}

// Main webhook handler
app.post("/webhook", async (req, res) => {
  try {
    const payload = req.body;
    console.log("📥 Incoming webhook payload:", payload);

    // Parse Bitrix document_id
    const document_id_raw = payload.document_id;
    let document_id;
    if (typeof document_id_raw === "string") {
      document_id = document_id_raw.split(",");
    } else {
      document_id = document_id_raw;
    }

    const [, , dynamicId] = document_id;
    const [, entityTypeId, itemId] = dynamicId.split("_");

    console.log(`🔍 Parsed entityTypeId=${entityTypeId}, itemId=${itemId}`);

    // Fetch Bitrix data
    const fieldsMeta = await getFieldDefinitions(entityTypeId);
    const item = await getItem(entityTypeId, itemId);
    const cleanData = transformItem(item, fieldsMeta);

    console.log("✅ Transformed Bitrix data:", cleanData);

    // Map to PropertyFinder format
    const pfPayload = await mapToPropertyFinderPayload(cleanData);
    console.log("📤 PropertyFinder payload:", JSON.stringify(pfPayload, null, 2));

    // Create listing on PropertyFinder
    const pfResult = await createPropertyFinderListing(pfPayload);

    if (pfResult.success) {
      console.log("🎉 PropertyFinder listing created successfully!");
      res.json({
        success: true,
        bitrixData: cleanData,
        propertyFinderPayload: pfPayload,
        propertyFinderResponse: pfResult.data
      });
    } else {
      console.error("❌ Failed to create PropertyFinder listing");
      res.status(500).json({
        success: false,
        bitrixData: cleanData,
        propertyFinderPayload: pfPayload,
        error: pfResult.error
      });
    }

  } catch (error) {
    console.error("💥 Error:", error.response?.data || error.message);
    res.status(500).json({
      success: false,
      error: error.toString()
    });
  }
});

// Health check endpoint
app.get("/health", (req, res) => {
  res.json({ status: "ok", timestamp: new Date().toISOString() });
});

app.listen(3000, () => {
  console.log("🚀 Server running on port 3000");
  console.log("📡 Webhook endpoint: http://localhost:3000/webhook");
});
