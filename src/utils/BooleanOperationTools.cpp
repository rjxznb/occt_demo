TopoDS_Shape BooleanOperationTools::BuildShapeFromBooleanOperation(BooleanOperationType InBooleanType, const TArray<TopoDS_Shape>& InBaseShapes, const TArray<TopoDS_Shape>& InToolShapes, float Tolerance)
{
	TUniquePtr<BRepAlgoAPI_BooleanOperation> BooleanOperation;
	TopoDS_Shape ResultShape;

	if (InBooleanType == BOP_Cut)
	{
		BooleanOperation.Reset(new BRepAlgoAPI_Cut);
	}
	else if (InBooleanType == BOP_Fuse)
	{
		BooleanOperation.Reset(new BRepAlgoAPI_Fuse);
	}
	else if (InBooleanType == BOP_Common)
	{
		BooleanOperation.Reset(new BRepAlgoAPI_Common);
	}
	else if (InBooleanType == BOP_Section)
	{
		BooleanOperation.Reset(new BRepAlgoAPI_Section);
	}
	if (!BooleanOperation.IsValid())
	{
		return TopoDS_Shape();
	}
	TopTools_ListOfShape ShapeArguments, ShapeTools;
	for (const auto& Shape : InBaseShapes) {
		ShapeArguments.Append(Shape);
	}
	for (const auto& Shape : InToolShapes) {
		ShapeTools.Append(Shape);
	}

	BooleanOperation->SetArguments(ShapeArguments);
	BooleanOperation->SetTools(ShapeTools);
	BooleanOperation->SetFuzzyValue(Tolerance);
	BooleanOperation->Build();
	if (BooleanOperation->IsDone())
	{
		ResultShape =  BooleanOperation->Shape();
	}

	return ResultShape;
}

bool BooleanOperationTools::BuildTriangulationFromCutBooleanOperation(BooleanOperationType InBooleanType, const TArray<TopoDS_Shape>& InBaseShapes, const TArray<TopoDS_Shape>& InToolShapes, TArray<FMeshTriangulation>& OutTriangulations)
{
	TopoDS_Shape BuildedShape = BuildShapeFromBooleanOperation(InBooleanType, InBaseShapes, InToolShapes);
	if (!BuildedShape.IsNull())
	{
		return FGeomUtils::BuildTriangulationFromShape(BuildedShape, OutTriangulations);
	}
	return false;
}

// FSimpleFaceChangeTracker 实现

void FSimpleFaceChangeTracker::BeginTracking(const TopoDS_Shape& OriginalShape)
{
    OriginalShapeRef = OriginalShape;
    FaceChanges.Empty();
    OperationSteps.Empty();
}

void FSimpleFaceChangeTracker::AddOperationStep(const TopoDS_Shape& InputShape, const TopoDS_Shape& OutputShape, 
                     const Handle(BRepTools_History)& History, const FString& OperationName)
{
    FOperationStep Step;
    Step.InputShape = InputShape;
    Step.OutputShape = OutputShape;
    Step.History = History;
    Step.OperationName = OperationName;
    OperationSteps.Add(Step);
}

void FSimpleFaceChangeTracker::EndTrackingWithSteps(const TopoDS_Shape& ResultShape)
{
    ResultShapeRef = ResultShape;
    OperationHistory = Handle(BRepTools_History)(); // 清空单一历史
}

void FSimpleFaceChangeTracker::AnalyzeFaceChangesWithSteps()
{
    FaceChanges.Empty();
    
    // 分析原始形状中的每个面
    TopExp_Explorer originalFaceExp(OriginalShapeRef, TopAbs_FACE);
    int32 originalFaceIndex = 0;
    
    for (; originalFaceExp.More(); originalFaceExp.Next(), originalFaceIndex++)
    {
        const TopoDS_Face& originalFace = TopoDS::Face(originalFaceExp.Current());
        
        FFaceChangeInfo changeInfo;
        changeInfo.OriginalFace = originalFace;
        changeInfo.OriginalFaceID = FString::Printf(TEXT("Face_%d"), originalFaceIndex);
        
        // 追踪面通过所有操作步骤的变化
        TArray<TopoDS_Face> currentFaces;
        currentFaces.Add(originalFace);
        bool faceDeleted = false;
        
        UE_LOG(LogTemp, Log, TEXT("追踪面 %s 通过 %d 个操作步骤"), 
            *changeInfo.OriginalFaceID, OperationSteps.Num());
        
        for (int32 stepIndex = 0; stepIndex < OperationSteps.Num(); stepIndex++)
        {
            const FOperationStep& step = OperationSteps[stepIndex];
            TArray<TopoDS_Face> nextFaces;
            
            UE_LOG(LogTemp, Log, TEXT("  步骤 %d (%s): 当前有 %d 个面"), 
                stepIndex, *step.OperationName, currentFaces.Num());
            
            for (const TopoDS_Face& currentFace : currentFaces)
            {
                if (!step.History.IsNull())
                {
                    if (step.History->IsRemoved(currentFace))
                    {
                        UE_LOG(LogTemp, Log, TEXT("    面在步骤 %d 中被删除"), stepIndex);
                        // 面被删除，不继续追踪
                        continue;
                    }
                    
                    const TopTools_ListOfShape& modifiedShapes = step.History->Modified(currentFace);
                    if (!modifiedShapes.IsEmpty())
                    {
                        // 面被修改
                        TopTools_ListIteratorOfListOfShape modIt(modifiedShapes);
                        for (; modIt.More(); modIt.Next())
                        {
                            if (modIt.Value().ShapeType() == TopAbs_FACE)
                            {
                                TopoDS_Face modifiedFace = TopoDS::Face(modIt.Value());
                                nextFaces.Add(modifiedFace);
                                UE_LOG(LogTemp, Log, TEXT("    面在步骤 %d 中被修改"), stepIndex);
                            }
                        }
                    }
                    else
                    {
                        // 面未变化，查找对应面
                        //TopoDS_Face correspondingFace = FindCorrespondingFace(currentFace, step.OutputShape);
                        //if (!correspondingFace.IsNull())
                        {
                            nextFaces.Add(currentFace);
                            UE_LOG(LogTemp, Log, TEXT("    面在步骤 %d 中未变化"), stepIndex);
                        }
                        //else
                        //{
                        //    UE_LOG(LogTemp, Log, TEXT("    面在步骤 %d 中找不到对应面"), stepIndex);
                        //}
                    }
                }
                else
                {
                    // 没有历史信息，尝试几何匹配
                    TopoDS_Face correspondingFace = FindCorrespondingFace(currentFace, step.OutputShape);
                    if (!correspondingFace.IsNull())
                    {
                        nextFaces.Add(correspondingFace);
                    }
                }
            }
            
            currentFaces = nextFaces;
            if (currentFaces.Num() == 0)
            {
                faceDeleted = true;
                UE_LOG(LogTemp, Log, TEXT("  面在步骤 %d 后完全消失"), stepIndex);
                break;
            }
        }
        
        // 根据追踪结果设置变化类型
        if (faceDeleted || currentFaces.Num() == 0)
        {
            changeInfo.ChangeType = EFaceChangeType::Deleted;
            UE_LOG(LogTemp, Log, TEXT("最终结果：面 %s 被删除"), *changeInfo.OriginalFaceID);
        }
        else if (currentFaces.Num() == 1 && IsSameFace(originalFace, currentFaces[0]))
        {
            changeInfo.ChangeType = EFaceChangeType::Unchanged;
            changeInfo.ResultingFaces = currentFaces;
            changeInfo.ResultingFaceIDs.Add(changeInfo.OriginalFaceID);
            UE_LOG(LogTemp, Log, TEXT("最终结果：面 %s 未变化"), *changeInfo.OriginalFaceID);
        }
        else if (currentFaces.Num() > 1)
        {
            changeInfo.ChangeType = EFaceChangeType::Split;
            changeInfo.ResultingFaces = currentFaces;
            for (int32 i = 0; i < currentFaces.Num(); i++)
            {
                changeInfo.ResultingFaceIDs.Add(FString::Printf(TEXT("%s_Split_%d"), 
                    *changeInfo.OriginalFaceID, i));
            }
            UE_LOG(LogTemp, Log, TEXT("最终结果：面 %s 被分割为 %d 个面"), 
                *changeInfo.OriginalFaceID, currentFaces.Num());
        }
        else
        {
            changeInfo.ChangeType = EFaceChangeType::Modified;
            changeInfo.ResultingFaces = currentFaces;
            changeInfo.ResultingFaceIDs.Add(FString::Printf(TEXT("%s_Modified"), 
                *changeInfo.OriginalFaceID));
            UE_LOG(LogTemp, Log, TEXT("最终结果：面 %s 被修改"), *changeInfo.OriginalFaceID);
        }
        
        FaceChanges.Add(changeInfo);
    }
    
    // 识别新生成的面
    IdentifyGeneratedFaces();
}

bool FSimpleFaceChangeTracker::IsSameFace(const TopoDS_Face& Face1, const TopoDS_Face& Face2)
{
    return Face1.IsSame(Face2);
}

TopoDS_Face FSimpleFaceChangeTracker::FindCorrespondingFace(const TopoDS_Face& OriginalFace, const TopoDS_Shape& ResultShape)
{
    // 简化实现：返回第一个找到的面
    TopExp_Explorer resultFaceExp(ResultShape, TopAbs_FACE);
    if (resultFaceExp.More())
    {
        return TopoDS::Face(resultFaceExp.Current());
    }
    return TopoDS_Face();
}

void FSimpleFaceChangeTracker::IdentifyGeneratedFaces()
{
    TopExp_Explorer resultFaceExp(ResultShapeRef, TopAbs_FACE);
    int32 generatedFaceIndex = 0;
    
    for (; resultFaceExp.More(); resultFaceExp.Next(), generatedFaceIndex++)
    {
        const TopoDS_Face& resultFace = TopoDS::Face(resultFaceExp.Current());
        
        // 检查这个面是否已经在变化列表中
        bool isTracked = false;
        for (const FFaceChangeInfo& changeInfo : FaceChanges)
        {
            for (const TopoDS_Face& trackedFace : changeInfo.ResultingFaces)
            {
                if (resultFace.IsSame(trackedFace))
                {
                    isTracked = true;
                    break;
                }
            }
            if (isTracked) break;
        }
        
        if (!isTracked)
        {
            // 这是一个新生成的面
            FFaceChangeInfo changeInfo;
            changeInfo.ChangeType = EFaceChangeType::Generated;
            changeInfo.ResultingFaces.Add(resultFace);
            changeInfo.ResultingFaceIDs.Add(FString::Printf(TEXT("GeneratedFace_%d"), generatedFaceIndex));
            
            FaceChanges.Add(changeInfo);
        }
    }
}
