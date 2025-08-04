using namespace std;

TopoDS_Face FGeomUtils::CreatePolygon(const TArray<FVector>& InPoints)
{
	if (InPoints.Num() <= 1)
	{
		return TopoDS_Face();
	}
    BRepBuilderAPI_MakePolygon mkPoly;
    for (FVector CurPoint : InPoints)
    {
        mkPoly.Add(gp_Pnt(CurPoint.X, CurPoint.Y, CurPoint.Z));
    }
	if (mkPoly.IsDone())
	{
		mkPoly.Close();
		BRepBuilderAPI_MakeFace mkFace(mkPoly.Wire());
		return mkFace.Face();
	}
   return TopoDS_Face();
}

TopoDS_Face FGeomUtils::CreatePolygon(const TArray<FVertexWithBulge>& InPoints)
{
	TopoDS_Wire Wire =  FGeomUtils::MakeWireFromVerticesWithBulge(InPoints);
	if (Wire.IsNull())
	{
		return TopoDS_Face();
	}
	BRepBuilderAPI_MakeFace faceBuilder(Wire);
	if (!faceBuilder.IsDone())
	{
		return TopoDS_Face();
	}
	return faceBuilder.Face();
}

bool FGeomUtils::CreateFaceFromCurves(const TArray<UGeomCurve*>& InCurves, TopoDS_Face& OutFace)
{
	BRepBuilderAPI_MakeWire MakeWire;
	for (const auto& Curve : InCurves)
	{
		if (!Curve)
		{
			return false;
		}
		if (Curve->ToShape().IsNull() || Curve->ToShape().ShapeType() != TopAbs_EDGE)
		{
			return false;
		}
		TopoDS_Edge CurveEdge = TopoDS::Edge(Curve->ToShape());
		MakeWire.Add(CurveEdge);
	}
	MakeWire.Build();
	if (!MakeWire.IsDone())
	{
		return false;
	}
	BRepBuilderAPI_MakeFace MakeFace(MakeWire.Wire()/*,true*/);
	if (!MakeFace.IsDone())
	{
		return false;
	}
	OutFace = MakeFace.Face();

	return true;
}

bool FGeomUtils::CreateClosedShapeFromCurves(const TArray<UGeomCurve*>& InCurves, TopoDS_Shape& OutShape)
{
	TArray<TopoDS_Wire> SpeparateWires = FGeomUtils::MakeIsolatedWireListFromCurves(InCurves);
	OutShape = FGeomUtils::MakeFaceFromClosedWiresNoIsland(SpeparateWires);
	return !OutShape.IsNull();
}

bool FGeomUtils::TriangulationVertices(const TArray<FVector>& InVertices, const TArray<int32>& InTriangles, FMeshTriangulation& OutMeshTriangulation)
{
	if (InTriangles.Num() % 3 != 0 || InTriangles.Num() < 3)
	{
		return false;
	}
	if (!InVertices.IsValidIndex(InTriangles[0]))
	{
		return false;
	}
	float MinX = InVertices[InTriangles[0]].X;
	float MinY = InVertices[InTriangles[0]].Y;
	FVector MinPoint;
	
	for (int32 Index = 1; Index < InTriangles.Num(); Index++)
	{
		if (InVertices.IsValidIndex(InTriangles[Index]))
		{
			FVector Point = InVertices[InTriangles[Index]];
			if (Point.X < MinX)
				MinX = Point.X;
			if (Point.Y < MinY)
				MinY = Point.Y;
		}
	}

	MinPoint.Set(MinX, MinY,0);
	FVector AlignPoint = MinPoint;
	
	FVector Normal = FVector(0, 0, 1);
	TArray<FVector> Normals;
	TArray<FVector2D> UVs;
	for (int32 Index = 0; Index < InVertices.Num(); Index++)
	{
		Normals.Add(Normal);
		FVector Point = InVertices[Index];
		float UCoord = (Point.X - AlignPoint.X);
		float VCoord = (Point.Y - AlignPoint.Y);
		FVector2D uv = FVector2D(UCoord, VCoord);
		uv = uv / 40;
		UVs.Add(uv);
	}
	OutMeshTriangulation.Vertices = InVertices;
	OutMeshTriangulation.Normals = Normals;
	OutMeshTriangulation.UVs = UVs;
	OutMeshTriangulation.Triangles = InTriangles;
	return true;
}

bool FGeomUtils::BuildTriangulationFromVerticesWithHoles(const TArray<FVector>& InVertices,	const TArray<TArray<FVector>>& InHoleVertices, TArray<FMeshTriangulation>& OutMeshTriangulations)
{
	auto Vertices = InVertices;
	auto HoleVertices = InHoleVertices;
	for (int i=0; i<Vertices.Num(); ++i)
	{
		FVector StartPos = Vertices[i];
		FVector EndPos = Vertices[(i + 1) % Vertices.Num()];
		for (auto& ItHole: HoleVertices)
		{
			for (auto& HoleVertex : ItHole)
			{
				if (FBKMath::IsPointOnLine2D(HoleVertex, StartPos, EndPos, 0.1))
				{
					FVector* FindPos = Vertices.FindByPredicate([HoleVertex](const FVector& InPos)->bool { return InPos.Equals(HoleVertex, 0.1); });
					if (FindPos)
					{
						HoleVertex = *FindPos;
					}
					else
					{
						FVector ProjPos = HoleVertex;
						if (FBKMath::GetLineSegmentProjectionPos(StartPos, EndPos, ProjPos))
						{
							HoleVertex = ProjPos;
						}
					}
				}
			}
		}
	}

	if (!FBKMath::IsClockwise(Vertices))
	{
		FBKMath::ReversePointList(Vertices);
	}
	TArray<TArray<FVector>> TriangleVertices;
	TArray<TArray<int32>> OutTriangles;
	Translate::ClipperGapVertsAndTriangle(Vertices,InHoleVertices,TriangleVertices, OutTriangles);
	for (int32 i = 0; i < TriangleVertices.Num(); ++i)
	{
		FMeshTriangulation MeshTriangulation;
		if (TriangulationVertices(TriangleVertices[i], OutTriangles[i], MeshTriangulation))
		{
			OutMeshTriangulations.Add(MeshTriangulation);
		}
		else
		{
			return false;
		}
	}
	return true;
}

bool FGeomUtils::TriangulationFace(const TopoDS_Shape& InFace, FMeshTriangulation& OutMeshTriangulation, float TriangularAccuracyFactor, FVector2D InUVScaleFactor)
{
	if (InFace.IsNull() || InFace.ShapeType() != TopAbs_FACE)
	{
		return false;
	}
	TopoDS_Face Face = TopoDS::Face(InFace);
	int NumTriangles = 0, NumNodes = 0, NumNorms = 0;
	BRepMesh_IncrementalMesh(InFace, TriangularAccuracyFactor);
	TopLoc_Location OutLoc;
	Handle(Poly_Triangulation) Mesh = BRep_Tool::Triangulation(Face, OutLoc);
	if (Mesh.IsNull())
	{
		return false;
	}
	FBox BoundingBox = GetBounds(InFace);

	NumTriangles += Mesh->NbTriangles();
	NumNodes += Mesh->NbNodes();

	const Poly_Array1OfTriangle& Triangles = Mesh->InternalTriangles();
	const Poly_ArrayOfNodes& Nodes = Mesh->InternalNodes();
	const Poly_ArrayOfUVNodes& UVNodes = Mesh->InternalUVNodes();

	const gp_Trsf& aTrsf = OutLoc.Transformation();
	bool bMirrored = aTrsf.VectorialPart().Determinant() < 0;
	StdPrs_ToolTriangulatedShape::ComputeNormals(Face, Mesh);
	const bool bHasTransform = !OutLoc.IsIdentity();
	bool bFaceReverse = (InFace.Orientation() == TopAbs_REVERSED);

	bool bHasUV = Mesh->HasUVNodes();
	Standard_Real aUmin(0.0), aUmax(0.0), aVmin(0.0), aVmax(0.0), dUmax(0.0), dVmax(0.0);
	BRepTools::UVBounds(Face, aUmin, aUmax, aVmin, aVmax);
	dUmax = (aUmax - aUmin);
	dVmax = (aVmax - aVmin);

	for (int32 Index = 1; Index <= NumNodes; Index++)
	{
		gp_Pnt aPoint = Mesh->Node(Index);
		gp_Dir aNorm = Mesh->HasNormals() ? Mesh->Normal(Index) : gp::DZ();
		if (bFaceReverse ^ bMirrored)
		{
			aNorm.Reverse();
		}
		if (bHasTransform)
		{
			aPoint.Transform(aTrsf);
			aNorm.Transform(aTrsf);
		}

		FVector Vert(aPoint.X(), aPoint.Y(), aPoint.Z());
		FVector Normal(aNorm.X(), aNorm.Y(), aNorm.Z());
		OutMeshTriangulation.Vertices.Add(Vert);
		OutMeshTriangulation.Normals.Add(Normal);

		if (bHasUV)
		{

			const gp_Pnt2d aNode2d = Mesh->UVNode(Index);
			const gp_Pnt2d aTexel = (dUmax == 0.0 || dVmax == 0.0) ? aNode2d
				: gp_Pnt2d((((aNode2d.X() - aUmin)) / dUmax),
					(((aNode2d.Y() - aVmin)) / dVmax));

			FVector2D UV0(aTexel.X()*InUVScaleFactor.X, aTexel.Y() * InUVScaleFactor.Y);
			OutMeshTriangulation.UVs.Add(UV0);
		}
	}

	for (int32 Index = 1; Index <= NumTriangles; Index++)
	{
		Standard_Integer N1, N2, N3;
		Triangles(Index).Get(N1, N2, N3);
		if (bFaceReverse)
		{
			OutMeshTriangulation.Triangles.Add(N1 - 1);
			OutMeshTriangulation.Triangles.Add(N2 - 1);
			OutMeshTriangulation.Triangles.Add(N3 - 1);
		}
		else
		{
			OutMeshTriangulation.Triangles.Add(N1 - 1);
			OutMeshTriangulation.Triangles.Add(N3 - 1);
			OutMeshTriangulation.Triangles.Add(N2 - 1);
		}
	}

	return true;
}

bool FGeomUtils::BuildTriangulationFromShape(const TopoDS_Shape& InShape, TArray<FMeshTriangulation>& OutMeshTriangulations, float TriangularAccuracyFactor, FVector2D InUVScaleFactor)
{
	if (InShape.IsNull())
	{
		return false;
	}
	TopTools_IndexedMapOfShape FaceMap;
	TopExp::MapShapes(InShape, TopAbs_FACE, FaceMap);
	OutMeshTriangulations.Empty();
	OutMeshTriangulations.AddDefaulted(FaceMap.Extent());
	for (int32 i = 1; i <= FaceMap.Extent(); i++)
	{
		FGeomUtils::TriangulationFace(TopoDS::Face(FaceMap(i)), OutMeshTriangulations[i - 1], TriangularAccuracyFactor, InUVScaleFactor);
	}
	return true;
}

FBox FGeomUtils::GetBounds(const TopoDS_Shape& InShape)
{
	if (InShape.IsNull())
	{
		return FBox(EForceInit::ForceInitToZero);
	}
	Bnd_Box Bounds;
	BRepBndLib::Add(InShape, Bounds);
	Bounds.SetGap(0.0);
	Standard_Real xMin, yMin, zMin, xMax, yMax, zMax;
	Bounds.Get(xMin, yMin, zMin, xMax, yMax, zMax);
	return FBox(FVector(xMin, yMin, zMin), FVector(xMax, yMax, zMax));
}

FVector FGeomUtils::CalculateCenterFromCurves(const TArray<UGeomTrimmedCurve*>& InCurves)
{
	if (InCurves.Num() == 0) return FVector::ZeroVector;

	FVector minPoint(FLT_MAX, FLT_MAX, FLT_MAX);
	FVector maxPoint(-FLT_MAX, -FLT_MAX, -FLT_MAX);

	for (const auto& curve : InCurves)
	{
		FVector startPoint = curve->GetStartPoint();
		FVector endPoint = curve->GetEndPoint();

		minPoint.X = FMath::Min(minPoint.X, FMath::Min(startPoint.X, endPoint.X));
		minPoint.Y = FMath::Min(minPoint.Y, FMath::Min(startPoint.Y, endPoint.Y));
		minPoint.Z = FMath::Min(minPoint.Z, FMath::Min(startPoint.Z, endPoint.Z));

		maxPoint.X = FMath::Max(maxPoint.X, FMath::Max(startPoint.X, endPoint.X));
		maxPoint.Y = FMath::Max(maxPoint.Y, FMath::Max(startPoint.Y, endPoint.Y));
		maxPoint.Z = FMath::Max(maxPoint.Z, FMath::Max(startPoint.Z, endPoint.Z));
	}

	return (minPoint + maxPoint) / 2.0f;
}

TArray<UGeometryBase*> FGeomUtils::TransformCurvesToLocal(const TArray<UGeometryBase*>& InCurves, const FTransform& InTransform)
{
	TArray<UGeometryBase*> RetTransformedCurves;

	for (const auto& Curve : InCurves)
	{
		if (!Curve)
		{
			continue;
		}
		UGeometryBase* TransformedGeometry = Curve->TransformCurves(InTransform);
		if (TransformedGeometry)
		{
			RetTransformedCurves.Add(TransformedGeometry);
		}
	}
	return RetTransformedCurves;
}

TArray<UGeometryBase*> FGeomUtils::TransformCurvesToWorld(const TArray<UGeometryBase*>& InCurves, const FTransform& InTransform)
{
	TArray<UGeometryBase*> RetTransformedCurves;

	for (const auto& Curve : InCurves)
	{
		if (!Curve)
		{
			continue;
		}
		UGeometryBase* TransformedGeometry = Curve->TransformCurves(InTransform,true);
		if (TransformedGeometry)
		{
			RetTransformedCurves.Add(TransformedGeometry);
		}
	}
	return RetTransformedCurves;
}

bool FGeomUtils::FindFacePositionOn(const TopoDS_Shape& InShape, const FVector& InPos, TopoDS_Face& OutFace, double Tolerance)
{
	TopTools_IndexedMapOfShape FaceMap;
	TopExp::MapShapes(InShape, TopAbs_FACE, FaceMap);
	for (int32 i = 1; i <= FaceMap.Extent(); i++)
	{
		gp_Pnt CheckPoint(InPos.X, InPos.Y, InPos.Z);
		BRepClass_FaceClassifier Classifier;
		Classifier.Perform(TopoDS::Face(FaceMap(i)), CheckPoint, Tolerance);
		if (Classifier.State() == TopAbs_ON || Classifier.State() == TopAbs_IN)
		{
			OutFace = TopoDS::Face(FaceMap(i));
			return true;
		}
	}
	return false;
}

bool FGeomUtils::IsPointOnFace(const TopoDS_Shape& InShape, const FVector& InPos, double Tolerance)
{
	if (InShape.IsNull())
	{
		return false;
	}
	gp_Pnt CheckPoint(InPos.X, InPos.Y, InPos.Z);
	BRepClass_FaceClassifier Classifier;
	if (InShape.ShapeType() == TopAbs_FACE)
	{
		TopoDS_Face Face = TopoDS::Face(InShape);
		Classifier.Perform(Face, CheckPoint, Tolerance);
		if (Classifier.State() == TopAbs_ON || Classifier.State() == TopAbs_IN)
		{
			return true;
		}
	}
	
	return false;
}

bool FGeomUtils::IsLineFaceIntersection(const FVector& InStartPos, const FVector& InDirection, const TopoDS_Shape& InShape, TopoDS_Face& OutHitFace, FVector& OutHitPoint, double Tolerance)
{
	if (InShape.IsNull())
	{
		return false;
	}
	gp_Pnt startPnt (InStartPos.X, InStartPos.Y, InStartPos.Z);
	gp_Dir lineDir(InDirection.X, InDirection.Y, InDirection.Z);
	if (InDirection.Equals(FVector::ZeroVector))
	{
		return false;
	}
	gp_Lin line(startPnt, lineDir);

	IntCurvesFace_ShapeIntersector Intersector;
	Intersector.Load(InShape, Tolerance);
	Intersector.Perform(line, 0, Precision::Infinite());

	Standard_Integer nbPoints = Intersector.NbPnt();
	if (nbPoints > 0)
	{
		gp_Pnt point = Intersector.Pnt(1);
		OutHitPoint = FVector(point.X(), point.Y(), point.Z());
		OutHitFace = Intersector.Face(1);
	}
	return !OutHitFace.IsNull();
}

bool FGeomUtils::IsLineSegmentFaceIntersection(const FVector& InStartPos, const FVector& InEndPos, const TopoDS_Shape& InShape, TopoDS_Face& OutHitFace, FVector& OutHitPoint, double Tolerance)
{
	if (InShape.IsNull())
	{
		return false;
	}
	FVector LineDir = InEndPos - InStartPos;
	float LineSegmentLength = LineDir.Size();
	gp_Pnt startPnt(InStartPos.X, InStartPos.Y, InStartPos.Z);
	gp_Dir lineDir(LineDir.X, LineDir.Y, LineDir.Z);
	gp_Lin line(startPnt, lineDir);

	IntCurvesFace_ShapeIntersector Intersector;
	Intersector.Load(InShape, Tolerance);
	Intersector.Perform(line, 0, LineSegmentLength);

	Standard_Integer nbPoints = Intersector.NbPnt();
	if (nbPoints > 0)
	{
		gp_Pnt point = Intersector.Pnt(1);
		OutHitPoint = FVector(point.X(), point.Y(), point.Z());
		OutHitFace = Intersector.Face(1);
	}
	return !OutHitFace.IsNull();
}

bool FGeomUtils::IsEdgeIntersectingPolygon(const TopoDS_Shape& InEdge, const TArray<FVector>& InPolygonPoints, double Tolerance)
{
	if (InEdge.IsNull())
	{
		return false;
	}
	if (InPolygonPoints.Num() < 3) 
	{
		return false;
	}
	if (InEdge.ShapeType() != TopAbs_EDGE)
	{
		return false;
	}
	const TopoDS_Edge& edge = TopoDS::Edge(InEdge);
	FVector OutStartPoint;
	FVector OutEndPoint;
	FGeomUtils::GetEdgeStartAndEnd(edge, OutStartPoint, OutEndPoint);
	TArray<FVector2D> PolygonPoints;
	for (auto& CurPoint : InPolygonPoints)
	{
		PolygonPoints.Add(FVector2D(CurPoint));
	}
	bool bEntireInPolygon = FGeomUtils::IsPointInOrOnPolygon2D(FVector2D(OutStartPoint), PolygonPoints) && 
		FGeomUtils::IsPointInOrOnPolygon2D(FVector2D(OutEndPoint), PolygonPoints);
	if (bEntireInPolygon)
	{
		return true;
	}
	TopoDS_Face PolygonFace = FGeomUtils::CreatePolygon(InPolygonPoints);
	return FGeomUtils::IsEdgeIntersectingFace(InEdge, PolygonFace, Tolerance);
}

bool FGeomUtils::IsEdgeIntersectingFace(const TopoDS_Shape& InEdge, const TopoDS_Shape& InFace, double Tolerance)
{
	if (InEdge.IsNull() || InFace.IsNull())
	{
		return false;
	}
	if (InEdge.ShapeType() != TopAbs_EDGE || InFace.ShapeType() != TopAbs_FACE)
	{
		return false;
	}
	const TopoDS_Edge& edge = TopoDS::Edge(InEdge);
	const TopoDS_Face& face = TopoDS::Face(InFace);

	TopTools_IndexedMapOfShape EdgeMap;
	TopExp::MapShapes(face, TopAbs_EDGE, EdgeMap);
	for (int i = 1; i <= EdgeMap.Extent(); i++)
	{
		const TopoDS_Edge& CurEdge = TopoDS::Edge(EdgeMap(i));
		if (AreEdgesIntersecting(InEdge, CurEdge, Tolerance))
		{
			return true;
		}
	}
	return false;
}

bool FGeomUtils::CheckParallelLineIntersection(const BRepAdaptor_Curve& InAdaptor1, const BRepAdaptor_Curve& InAdaptor2, 
	double InFirst1, double InLast1, double InFirst2, double InLast2, double InTolerance, bool& OutIsIntersecting)
{
	// 获取直线的方向向量
	gp_Dir dir1 = InAdaptor1.Line().Direction();
	gp_Dir dir2 = InAdaptor2.Line().Direction();
	
	// 检查方向向量是否平行（点积接近 ±1）
	double dotProduct = fabs(dir1.Dot(dir2));
	const double ParallelTolerance = 1.0 - FPrecision::AngleConfusion();
	
	if (dotProduct > ParallelTolerance)
	{
		// 平行线即便重叠也不算相交
		OutIsIntersecting = false;
		//// 直线平行或共线，检查是否共线且有重叠
		//gp_Lin line1 = InAdaptor1.Line();
		//gp_Lin line2 = InAdaptor2.Line();
		//
		//// 检查第二条线的起点到第一条线的距离
		//gp_Pnt point2_start = InAdaptor2.Value(InFirst2);
		//double distanceToLine = line1.Distance(point2_start);
		//
		//if (distanceToLine <= InTolerance)
		//{
		//	// 共线，检查线段是否重叠
		//	OutIsIntersecting = CheckCollinearLineSegmentOverlap(line1, InAdaptor2, InFirst1, InLast1, InFirst2, InLast2);
		//}
		//else
		//{
		//	// 平行但不共线，不相交
		//	OutIsIntersecting = false;
		//}
		return true; // 已处理平行线情况
	}
	
	return false; // 不是平行线，需要继续其他处理
}

bool FGeomUtils::CheckCollinearLineSegmentOverlap(const gp_Lin& InLine1, const BRepAdaptor_Curve& InAdaptor2, 
	double InFirst1, double InLast1, double InFirst2, double InLast2)
{
	// 将第二条线的端点投影到第一条线上
	gp_Pnt point2_start = InAdaptor2.Value(InFirst2);
	gp_Pnt point2_end = InAdaptor2.Value(InLast2);
	
	// 计算投影参数
	double param2_start_on_line1 = ElCLib::Parameter(InLine1, point2_start);
	double param2_end_on_line1 = ElCLib::Parameter(InLine1, point2_end);
	
	// 确保参数顺序正确
	if (param2_start_on_line1 > param2_end_on_line1)
	{
		std::swap(param2_start_on_line1, param2_end_on_line1);
	}
	
	// 检查线段是否重叠
	return !(param2_end_on_line1 < InFirst1 || param2_start_on_line1 > InLast1);
}

bool FGeomUtils::AreEdgesIntersecting(const TopoDS_Shape& InEdge1, const TopoDS_Shape& InEdge2, double Tolerance)
{
	if (InEdge1.IsNull() || InEdge2.IsNull() || InEdge1.ShapeType() != TopAbs_EDGE || InEdge2.ShapeType() != TopAbs_EDGE)
	{
		return false;
	}
	const TopoDS_Edge& edge1 = TopoDS::Edge(InEdge1);
	const TopoDS_Edge& edge2 = TopoDS::Edge(InEdge2);
	double first1, last1, first2, last2;
	Handle(Geom_Curve) curve1 = BRep_Tool::Curve(edge1, first1, last1);
	Handle(Geom_Curve) curve2 = BRep_Tool::Curve(edge2, first2, last2);

	// 检查曲线是否有效
	if (curve1.IsNull() || curve2.IsNull())
	{
		return false;
	}

	// 检查是否为直线类型，如果是则进行平行检测以避免 OCCT 崩溃
	BRepAdaptor_Curve adaptor1(edge1);
	BRepAdaptor_Curve adaptor2(edge2);
	
	if (adaptor1.GetType() == GeomAbs_Line && adaptor2.GetType() == GeomAbs_Line)
	{
		bool bIsIntersecting = false;
		if (CheckParallelLineIntersection(adaptor1, adaptor2, first1, last1, first2, last2, Tolerance, bIsIntersecting))
		{
			return bIsIntersecting;
		}
	}

	// 对于非平行线或非直线，使用原有的 GeomAPI_ExtremaCurveCurve 方法
	GeomAPI_ExtremaCurveCurve extrema(curve1, curve2);

	if (extrema.NbExtrema() == 0)
	{
		return false;
	}

	for (int index = 1; index <= extrema.NbExtrema(); index++)
	{
		double param1, param2;
		extrema.Parameters(index, param1, param2);

		// Check if the parameters are within the valid range of the edges
		if (param1 >= first1 && param1 <= last1 && param2 >= first2 && param2 <= last2) 
		{
			if (extrema.Distance(index) <= Tolerance) 
			{
				return true; // Intersection found within tolerance
			}
		}
	}
	return false;
}

bool FGeomUtils::IsPointOnEdgeOfShape(const FVector& InPointPos, const TopoDS_Shape& InShape, TopoDS_Edge& OutEdge, double Tolerance)
{
	if (InShape.IsNull())
	{
		return false;
	}
	TopTools_IndexedMapOfShape EdgeMap;
	TopExp::MapShapes(InShape, TopAbs_EDGE, EdgeMap);
	for (int i = 1; i <= EdgeMap.Extent(); i++)
	{
		const TopoDS_Edge& Edge = TopoDS::Edge(EdgeMap(i));
		if (IsPointOnEdge(InPointPos, Edge, Tolerance))
		{
			OutEdge = Edge;
			return true;
		}
	}
	return false;
}

bool FGeomUtils::IsPointOnVertexOfShape(const FVector& InPointPos, const TopoDS_Shape& InShape, TopoDS_Vertex& OutVertex, double Tolerance)
{
	if (InShape.IsNull())
	{
		return false;
	}
	TopTools_IndexedMapOfShape vertexMap;
	TopExp::MapShapes(InShape, TopAbs_VERTEX, vertexMap);

	for (int i = 1; i <= vertexMap.Extent(); ++i) {
		const TopoDS_Vertex& Vertex = TopoDS::Vertex(vertexMap(i));
		gp_Pnt vertexPoint = BRep_Tool::Pnt(Vertex);

		FVector VertexOfShape(vertexPoint.X(), vertexPoint.Y(), vertexPoint.Z());

		if (FVector::Dist(InPointPos, VertexOfShape) <= Tolerance) {
			OutVertex = Vertex;
			return true; 
		}
	}
	return false; 
}

bool FGeomUtils::IsPointOnEdge(const FVector& InPointPos, const TopoDS_Shape& InEdge, double Tolerance)
{
	if (InEdge.IsNull())
	{
		return false;
	}
	if (InEdge.ShapeType() != TopAbs_EDGE)
	{
		return false;
	}

	double First, Last;
	Handle(Geom_Curve) curve = BRep_Tool::Curve(TopoDS::Edge(InEdge), First, Last);

	if (curve.IsNull()) 
	{
		return false; 
	}

	gp_Pnt point(InPointPos.X, InPointPos.Y, InPointPos.Z);
	GeomAPI_ProjectPointOnCurve projector(point, curve);

	if (projector.NbPoints() > 0) 
	{
		double parameter = projector.LowerDistanceParameter();
		if (parameter >= First && parameter <= Last) 
		{
			if (projector.LowerDistance() <= Tolerance) 
			{
				return true;
			}
		}
	}

	return false;
}

UGeomPoint* FGeomUtils::GetGeomPointFromVertex(const TopoDS_Shape& InVertex)
{
	if (InVertex.IsNull() || InVertex.ShapeType() != TopAbs_VERTEX)
	{
		return nullptr;
	}
	const TopoDS_Vertex& Vertex = TopoDS::Vertex(InVertex);
	gp_Pnt point = BRep_Tool::Pnt(Vertex);
	UGeomPoint* GeomPoint = NewObject<UGeomPoint>();
	GeomPoint->SetPoint(FVector(point.X(), point.Y(), point.Z()));
	GeomPoint->SetShape(Vertex);
	return GeomPoint;
}

UGeomCurve* FGeomUtils::GetGeomCurveFromEdge(const TopoDS_Shape& InEdge)
{
	if (InEdge.IsNull() || InEdge.ShapeType() != TopAbs_EDGE)
	{
		return nullptr;
	}
	const TopoDS_Edge& Edge = TopoDS::Edge(InEdge);
	
	FVector StartPos, EndPos;
	GetEdgeStartAndEnd(Edge, StartPos, EndPos, true);
	UGeomCurve* RetCurve = nullptr;
	// 获取边的几何曲线
	BRepAdaptor_Curve Curve(Edge);
	// 获取曲线的类型
	GeomAbs_CurveType CurveType = Curve.GetType();
	if (CurveType == GeomAbs_Circle)
	{
		FVector MiddlePos = GetMiddlePointOnEdge(Edge);
		RetCurve = FGeomUtils::MakeGeomArcOfCircle(StartPos, EndPos, MiddlePos);
	}
	else/* if (CurveType == GeomAbs_Line)*/
	{
		UGeomLineSegment* CurEdge = NewObject<UGeomLineSegment>();
		CurEdge->SetPoints(StartPos, EndPos);
		RetCurve = CurEdge;
	}
	return RetCurve;
}

TArray<UGeomCurve*> FGeomUtils::GetGeomCurveListFromEdges(const TArray<TopoDS_Edge>& InEdges)
{
	TArray<UGeomCurve*> RetGeomCurves;

	for (const TopoDS_Shape& Edge : InEdges)
	{
		if (Edge.IsNull())
		{
			continue;
		}
		UGeomCurve* Curve = FGeomUtils::GetGeomCurveFromEdge(Edge);
		if (Curve != nullptr)
		{
			RetGeomCurves.Add(Curve);
		}
	}

	return RetGeomCurves;
}

UGeomSurface* FGeomUtils::GetGeomSurfaceFromFace(const TopoDS_Shape& InFace)
{
	if (InFace.IsNull() || InFace.ShapeType() != TopAbs_FACE)
	{
		return nullptr;
	}

	const TopoDS_Face& Face = TopoDS::Face(InFace);
	UGeomSurface* RetSurface = nullptr;
	// 获取边的几何曲线
	BRepAdaptor_Surface Surface(Face);
	// 获取曲线的类型
	GeomAbs_SurfaceType SurfaceType = Surface.GetType();
	if (SurfaceType == GeomAbs_Cylinder)
	{
		UGeomTrimmedSurface* CurSurface = NewObject<UGeomTrimmedSurface>();
		Standard_Real aUmin(0.0), aUmax(0.0), aVmin(0.0), aVmax(0.0), dUmax(0.0), dVmax(0.0);
		BRepTools::UVBounds(Face, aUmin, aUmax, aVmin, aVmax);
		Handle(Geom_RectangularTrimmedSurface) cylindricalSurface = new Geom_RectangularTrimmedSurface(Surface.Surface().Surface(), aUmin, aUmax, aVmin, aVmax);
		CurSurface->SetHandle(cylindricalSurface);
		RetSurface = CurSurface;
	}
	else if (SurfaceType == GeomAbs_Plane)
	{
		UGeomTrimmedPlane* RetGeometry = NewObject<UGeomTrimmedPlane>();
		RetGeometry->SetShape(InFace);
		RetSurface = RetGeometry;
	}

	return RetSurface;
}

UGeometryBase* FGeomUtils::GetGeometryFromShape(const TopoDS_Shape& InShape)
{
	if (InShape.IsNull())
	{
		return nullptr;
	}
	UGeometryBase* RetGeometry = nullptr;
	if (InShape.ShapeType() == TopAbs_FACE)
	{
		RetGeometry = FGeomUtils::GetGeomSurfaceFromFace(InShape);
	}
	else if (InShape.ShapeType() == TopAbs_EDGE)
	{
		RetGeometry = FGeomUtils::GetGeomCurveFromEdge(InShape);
	}
	else if (InShape.ShapeType() == TopAbs_VERTEX)
	{
		RetGeometry = FGeomUtils::GetGeomPointFromVertex(InShape);
	}
	return RetGeometry;
}

bool FGeomUtils::GetGeomCurvesFromWire(const TopoDS_Shape& InWire, TArray<UGeomCurve*>& OutCurves)
{
	TArray<TopoDS_Edge> OutEdges;
	if (GetShapeEdges(InWire, OutEdges))
	{
		for (int32 i = 0; i < OutEdges.Num(); i++)
		{
			UGeomCurve* GeomCurve = GetGeomCurveFromEdge(OutEdges[i]);
			if (!GeomCurve)
			{
				continue;
			}
			OutCurves.Add(GeomCurve);
		}
		return true;
	}
	return false;
}

void FGeomUtils::GetGeomCurvesFromPoints(TArray<FVertexWithBulge> InPoints, TArray<UGeomCurve*>& OutCurves, bool bClose,float Tolerance)
{
	//倒序过滤，正序过滤会产生边与边之间的缝隙
	for (int32 i = InPoints.Num() - 1; i > 0; i--)
	{
		const FVertexWithBulge& Vertex1 = InPoints[i];
		const FVertexWithBulge& Vertex2 = InPoints[i-1];
		if (Vertex1.Equals(Vertex2, Tolerance))
		{
			InPoints.RemoveAt(i);
		}
	}
	int32 NumPoints = bClose ? InPoints.Num() : InPoints.Num() - 1;
	for (int32 i = 0; i < NumPoints; ++i)
	{
		const FVertexWithBulge& Vertex1 = InPoints[i];
		const FVertexWithBulge& Vertex2 = InPoints[(i + 1) % InPoints.Num()];

		if (Vertex1.Equals(Vertex2, Tolerance))
		{
			//主要是为了避免首尾点一致
			continue;
		}

		if (Vertex1.Bulge != 0)
		{
			UGeomArcOfCircle* ArcOfCircle = FGeomUtils::MakeGeomArcOfCircle(Vertex1.Position, Vertex2.Position, Vertex1.Bulge);
			if (ArcOfCircle)
			{
				OutCurves.Add(ArcOfCircle);
			}
		}
		else
		{
			UGeomLineSegment* LineSegment = FGeomUtils::MakeGeomLineSegment(Vertex1.Position, Vertex2.Position);
			if (LineSegment)
			{
				OutCurves.Add(LineSegment);
			}
		}
	}
}

void FGeomUtils::GetGeomCurvesFromPoints(const TArray<FVector>& InPoints, TArray<UGeomCurve*>& OutCurves, bool bClose,bool bZBulge, float Tolerance)
{
	TArray<FVertexWithBulge> TempPoints;
	for (const FVector& It : InPoints)
	{
		if (bZBulge)
		{
			TempPoints.Add(FVertexWithBulge(FVector(It.X,It.Y,0), It.Z));
		}
		else
		{
			TempPoints.Add(FVertexWithBulge(It, 0.f));
		}
	}

	GetGeomCurvesFromPoints(TempPoints, OutCurves, bClose, Tolerance);
}

FVector FGeomUtils::GetPointOnEdge(const TopoDS_Edge& InEdge, double InParameter)
{
	if (InEdge.IsNull())
	{
		return FVector::ZeroVector;
	}
	BRepAdaptor_Curve Curve(InEdge);
	gp_Pnt point;
	Curve.D0(InParameter, point);
	return FVector(point.X(), point.Y(), point.Z());
}

FVector FGeomUtils::GetMiddlePointOnEdge(const TopoDS_Edge& InEdge)
{
	BRepAdaptor_Curve Curve(InEdge);
	double first = Curve.FirstParameter();
	double last = Curve.LastParameter();
	double mid = (first + last) / 2.0;

	gp_Pnt point;
	Curve.D0(mid, point);
	return FVector(point.X(), point.Y(), point.Z());
}

bool FGeomUtils::GetShapeEdges(const TopoDS_Shape& InShape, TArray<TopoDS_Edge>& OutEdges)
{
	if (InShape.IsNull())
	{
		return false;
	}
	TopTools_IndexedMapOfShape EdgeMap;
	TopExp::MapShapes(InShape, TopAbs_EDGE, EdgeMap);

	for (int i = 1; i <= EdgeMap.Extent(); i++)
	{
		const TopoDS_Edge& Edge = TopoDS::Edge(EdgeMap(i));
		OutEdges.Add(Edge);
	}
	return true;
}

bool FGeomUtils::GetShapeCurves(const TopoDS_Shape& InShape, TArray<UGeomCurve*>& OutCurves)
{
	if (InShape.IsNull())
	{
		return false;
	}
	TArray<TopoDS_Edge> Edges;
	if (GetShapeEdges(InShape, Edges))
	{
		for (const TopoDS_Edge& It : Edges)
			OutCurves.Add(FGeomUtils::GetGeomCurveFromEdge(It));

		return true;
	}
	
	return false;
}

bool FGeomUtils::GetShapeFaces(const TopoDS_Shape& InShape, TArray<TopoDS_Face>& OutFaces)
{
	if (InShape.IsNull())
	{
		return false;
	}
	TopTools_IndexedMapOfShape FaceMap;
	TopExp::MapShapes(InShape, TopAbs_FACE, FaceMap);

	for (int i = 1; i <= FaceMap.Extent(); i++)
	{
		const TopoDS_Face& Face = TopoDS::Face(FaceMap(i));
		OutFaces.Add(Face);
	}
	return true;
}

bool FGeomUtils::GetEdgeStartAndEnd(const TopoDS_Edge& InEdge, FVector& OutStartPoint, FVector& OutEndPoint, bool bTakeAccountEdgeOrient)
{
	if (InEdge.IsNull())
	{
		return false;
	}
	TopoDS_Vertex StartVertex = TopExp::FirstVertex(InEdge, bTakeAccountEdgeOrient);
	TopoDS_Vertex EndVertex = TopExp::LastVertex(InEdge, bTakeAccountEdgeOrient);
	if (StartVertex.IsNull() || EndVertex.IsNull())
	{
		return false;
	}

	gp_Pnt FirstPoint = BRep_Tool::Pnt(StartVertex);
    gp_Pnt LastPoint = BRep_Tool::Pnt(EndVertex);
	OutStartPoint = FVector(FirstPoint.X(), FirstPoint.Y(), FirstPoint.Z());
	OutEndPoint = FVector(LastPoint.X(), LastPoint.Y(), LastPoint.Z());
	return true;
}

float FGeomUtils::ComputeDistance(const TopoDS_Shape& InFirstShape, const TopoDS_Shape& InSecondShape)
{
	BRepExtrema_DistShapeShape DistShape(InFirstShape, InSecondShape);
	DistShape.Perform();
	Standard_Real Distance = DistShape.Value();
	return Distance;
}

bool FGeomUtils::GetShapeVertexes(const TopoDS_Shape& InShape, TArray<TopoDS_Vertex>& OutVertexs)
{
	if (InShape.IsNull())
	{
		return false;
	}

	TopTools_IndexedMapOfShape vertexMap;
	TopExp::MapShapes(InShape, TopAbs_VERTEX, vertexMap);

	for (int i = 1; i <= vertexMap.Extent(); ++i)
	{
		const TopoDS_Vertex& vertex = TopoDS::Vertex(vertexMap(i));
		OutVertexs.Add(vertex);
	}

	return OutVertexs.Num() > 0; 
}

bool FGeomUtils::GetShapeShells(const TopoDS_Shape& InShape, TArray<TopoDS_Shell>& OutShells)
{
	if (InShape.IsNull())
	{
		return false;
	}
	TopTools_IndexedMapOfShape ShellMap;
	TopExp::MapShapes(InShape, TopAbs_SHELL, ShellMap);

	for (int i = 1; i <= ShellMap.Extent(); ++i)
	{
		const TopoDS_Shell& shell = TopoDS::Shell(ShellMap(i));
		OutShells.Add(shell);
	}

	return OutShells.Num() > 0;
}

bool FGeomUtils::GetShapeVertexes(const TopoDS_Shape& InShape, TArray<FVector>& OutPoints)
{
	if (InShape.IsNull())
	{
		return false;
	}
	TArray<TopoDS_Vertex> OutVertexs;
	if (GetShapeVertexes(InShape, OutVertexs))
	{
		for (auto CurVertex : OutVertexs)
		{
			gp_Pnt point = BRep_Tool::Pnt(CurVertex);
			OutPoints.Add(FVector(point.X(), point.Y(), point.Z()));
		}
		return true;
	}
	return false;
}

void FGeomUtils::GetVertexWithBulgesFromEdge(const TopoDS_Edge& InEdge, FVertexWithBulge& OutStart, FVertexWithBulge& OutEnd, bool bTakeAccountEdgeOrient)
{
	FVector StartPoint, EndPoint;
	
	UGeomCurve *GeomCurve = FGeomUtils::GetGeomCurveFromEdge(InEdge);
	if (GeomCurve && GeomCurve->IsA(UGeomLineSegment::StaticClass()))
	{
		if (!FGeomUtils::GetEdgeStartAndEnd(InEdge, StartPoint, EndPoint, bTakeAccountEdgeOrient))
		{
			return;
		}
		OutStart = (FVertexWithBulge(StartPoint, 0));
		OutEnd = (FVertexWithBulge(EndPoint, 0));
	}
	else if (GeomCurve && GeomCurve->IsA(UGeomArcOfCircle::StaticClass()))
	{
		UGeomArcOfCircle *ArcOfCircle = StaticCast<UGeomArcOfCircle *>(GeomCurve);
		float Bulge = ArcOfCircle->GetBulge();
		StartPoint = ArcOfCircle->GetStartPoint();
		EndPoint = ArcOfCircle->GetEndPoint();

		OutStart = FVertexWithBulge(StartPoint, Bulge);
		OutEnd = (FVertexWithBulge(EndPoint, 0));
	}
	else
	{
		UE_LOG(LogTemp, Warning, TEXT("GetVertexWithBulgesFromEdge: Unsupported curve type"));
	}
}

bool FGeomUtils::GetShapeFVertexWithBulge(const TopoDS_Shape& InShape, TArray<FVertexWithBulge>& OutVertexWithBulges, bool bSortEdges /*= false*/)
{
	if (InShape.IsNull())
	{
		return false;
	}

	OutVertexWithBulges.Empty();

	// 如果输入是Wire
	if (InShape.ShapeType() == TopAbs_WIRE)
	{
		TopoDS_Wire CurrentWire = TopoDS::Wire(InShape);
		TArray<TopoDS_Edge> EdgesToIterate;

		if (bSortEdges)
		{
			TArray<TopoDS_Edge> OriginalEdges;
			TopExp_Explorer exp(CurrentWire, TopAbs_EDGE);
			for (; exp.More(); exp.Next()) {
				OriginalEdges.Add(TopoDS::Edge(exp.Current()));
			}

			if (OriginalEdges.Num() > 0) {
				// 使用默认公差进行排序，如果需要，可以调整 FPrecision::Confusion()
				EdgesToIterate = SortEdgesWithOCCTWireOrder(OriginalEdges, FPrecision::Confusion());
			}
			// 如果 OriginalEdges 为空, EdgesToIterate 将为空, 下面的循环不会执行
		}
		else
		{
			// 如果不排序, 直接从 CurrentWire 获取边用于迭代
            // BRepTools_WireExplorer 保证了迭代的顺序性
			BRepTools_WireExplorer WireExp(CurrentWire);
			for(; WireExp.More(); WireExp.Next())
			{
				EdgesToIterate.Add(WireExp.Current());
			}
		}

		int32 EdgeNum = EdgesToIterate.Num();
		int32 Index = 0;
		for (const TopoDS_Edge& Edge : EdgesToIterate)
		{
			FVertexWithBulge StartVertex, EndVertex;
			// GetVertexWithBulgesFromEdge 会考虑边的方向
			// 如果进行了排序, SortEdgesWithOCCTWireOrder 已经设置了正确的方向
			GetVertexWithBulgesFromEdge(Edge, StartVertex, EndVertex, true); // 明确 bTakeAccountEdgeOrient = true
			OutVertexWithBulges.Add(StartVertex);

			if(Index == EdgeNum-1)
				OutVertexWithBulges.Add(EndVertex);

			Index++;
		}
	}
	// 如果输入是Face，获取外部Wire
	else if (InShape.ShapeType() == TopAbs_FACE)
	{
		TopoDS_Wire OuterWire = BRepTools::OuterWire(TopoDS::Face(InShape));
		return GetShapeFVertexWithBulge(OuterWire, OutVertexWithBulges, bSortEdges); // 传递 bSortEdges 参数
	}
	// 对于其他类型的形状，先尝试创建Wire
	else
	{
		TArray<TopoDS_Edge> Edges;
		if (GetShapeEdges(InShape, Edges))
		{
			// CreateWiresFromEdges 尝试从一组边创建线框
			// 注意：这里的CreateWiresFromEdges本身可能也需要考虑排序，
			// 但我们当前仅修改GetShapeFVertexWithBulge的行为
			TArray<TopoDS_Wire> OrderedWires = CreateWiresFromEdges(Edges);
			if (OrderedWires.Num() > 0)
			{
				// 对创建的第一个线框递归调用，并传递 bSortEdges 参数
				return GetShapeFVertexWithBulge(OrderedWires[0], OutVertexWithBulges, bSortEdges);
			}
		}
	}

	return OutVertexWithBulges.Num() > 0;
}

bool FGeomUtils::FindVertexPositionOn(const TopoDS_Shape& InShape, const FVector& InPoint, TopoDS_Vertex& OutVertex, double Tolerance)
{
	if (InShape.IsNull())
	{
		return false;
	}
	gp_Pnt CheckPoint(InPoint.X, InPoint.Y, InPoint.Z);
	BRepBuilderAPI_MakeVertex MakeVertex(CheckPoint);
	TopoDS_Shape VertexShape = MakeVertex.Shape();

	TopTools_IndexedMapOfShape VertexMap;
	TopExp::MapShapes(InShape, TopAbs_VERTEX, VertexMap);

	// 遍历面的边缘
	for (int i = 1; i <= VertexMap.Extent(); i++)
	{
		const TopoDS_Vertex& Vertex = TopoDS::Vertex(VertexMap(i));
		if (ComputeDistance(VertexShape, Vertex) < Tolerance)
		{
			OutVertex = Vertex;
			return true;
		}
	}

	return false;
}

UGeomLineSegment* FGeomUtils::MakeGeomLineSegment(FVector InStartPos, FVector InEndPos)
{
	UGeomLineSegment* LineSegment = NewObject<UGeomLineSegment>();
	LineSegment->SetPoints(InStartPos, InEndPos);
	return LineSegment;
}

UGeomArcOfCircle* FGeomUtils::MakeGeomArcOfCircle(FVector InStartPos, FVector InEndPos, double InBulge)
{
	if (FMath::Abs(InBulge) > 9999.0)
	{
		return nullptr;
	}
	FLineWithBulge ArcEdge(InStartPos, InEndPos, InBulge);
	FVector Center = ArcEdge.GetCenter();
	float Radius = ArcEdge.GetRadius();
	FVector Apex = ArcEdge.GetArcApex();

	return MakeGeomArcOfCircle(InStartPos, InEndPos, Apex);
}

UGeomArcOfCircle* FGeomUtils::MakeGeomArcOfCircle(FVector InStartPos, FVector InEndPos, FVector InMiddlePos)
{
	if (InStartPos.Equals(InEndPos, 0.1) || InStartPos.Equals(InMiddlePos, 0.1) || InEndPos.Equals(InMiddlePos, 0.1))
	{
		return nullptr;
	}
	gp_Pnt StartPos(InStartPos.X, InStartPos.Y, InStartPos.Z);
	gp_Pnt EndPos(InEndPos.X, InEndPos.Y, InEndPos.Z);
	gp_Pnt MiddlePos(InMiddlePos.X, InMiddlePos.Y, InMiddlePos.Z);
	Handle(Geom_TrimmedCurve) aArcOfCircle = GC_MakeArcOfCircle(StartPos, MiddlePos, EndPos).Value();
	UGeomArcOfCircle* ArcOfCircle = NewObject<UGeomArcOfCircle>();
	ArcOfCircle->SetHandle(aArcOfCircle);
	return ArcOfCircle;
}

bool FGeomUtils::CreateSolidFromExtrusionOfProfileFace(const TArray<UGeomCurve*>& InProfileEdges, FVector InExtrusionDir, TopoDS_Shape& OutSolid)
{
	TopoDS_Face OutProfileFace;
	if (!FGeomUtils::CreateFaceFromCurves(InProfileEdges, OutProfileFace))
	{
		return false;
	}

	return !CreateSolidFromExtrusionOfProfileFaceShape(OutProfileFace, InExtrusionDir, OutSolid);
}

bool FGeomUtils::CreateSolidFromExtrusionOfProfileFace(const TArray<FVector>& InProfileVerts, FVector InExtrusionDir, TopoDS_Shape& OutSolid)
{
	TopoDS_Face OutProfileFace = FGeomUtils::CreatePolygon(InProfileVerts);
	return !CreateSolidFromExtrusionOfProfileFaceShape(OutProfileFace, InExtrusionDir, OutSolid);
}

bool FGeomUtils::CreateSolidFromExtrusionOfProfileFace(const TArray<UGeomCurve*>& InProfileEdges, TArray<FVector> InPath, TopoDS_Shape& OutSolid)
{
	TopoDS_Face OutProfileFace;
	if (!FGeomUtils::CreateFaceFromCurves(InProfileEdges, OutProfileFace))
	{
		return false;
	}

	return !CreateSolidFromExtrusionOfProfileFaceShape(OutProfileFace, InPath, OutSolid);
}

bool FGeomUtils::CreateSolidFromExtrusionOfProfileFace(const TArray<FVector>& InProfileVerts, TArray<FVector> InPath, TopoDS_Shape& OutSolid)
{
	TopoDS_Face OutProfileFace = FGeomUtils::CreatePolygon(InProfileVerts);
	return !CreateSolidFromExtrusionOfProfileFaceShape(OutProfileFace, InPath, OutSolid);
}

bool FGeomUtils::CreateSolidFromExtrusionOfProfileFaceShape(const TopoDS_Shape& InProfileFace, FVector InExtrusionDir, TopoDS_Shape& OutSolid)
{
	if (InProfileFace.IsNull() || InProfileFace.ShapeType() != TopAbs_FACE || InExtrusionDir.IsNearlyZero())
	{
		return false;
	}
	gp_Vec ExtrusionDir(InExtrusionDir.X, InExtrusionDir.Y, InExtrusionDir.Z);
	BRepPrimAPI_MakePrism MakePrism(InProfileFace, ExtrusionDir);
	OutSolid = MakePrism.Shape();
	return !OutSolid.IsNull();
}

bool FGeomUtils::CreateSolidFromExtrusionOfProfileFaceShape(const TopoDS_Shape& InProfileFace, TArray<FVector> InPath, TopoDS_Shape& OutSolid)
{
	if (InProfileFace.IsNull() || InProfileFace.ShapeType() == TopAbs_SOLID)
	{
		return false;
	}

	TopoDS_Wire PathWire = FGeomUtils::CreateWireFromPoints(InPath);

	BRepOffsetAPI_MakePipe MakePipe(PathWire, InProfileFace, GeomFill_IsFrenet, true);

	OutSolid = MakePipe.Shape();
	return !OutSolid.IsNull();
}

TopoDS_Wire FGeomUtils::CreateWireFromPoints(const TArray<FVector>& InPoints)
{
	TArray<TopoDS_Vertex> Vertices;
	TArray<TopoDS_Edge> Edges;

	for (const auto& Point : InPoints)
	{
		gp_Pnt aPoint(Point.X, Point.Y, Point.Z);
		TopoDS_Vertex Vertex = BRepBuilderAPI_MakeVertex(aPoint);
		Vertices.Add(Vertex);
	}

	for (int32 i = 0; i < Vertices.Num() - 1; i++)
	{
		TopoDS_Edge Edge = BRepBuilderAPI_MakeEdge(Vertices[i], Vertices[i + 1]);
		Edges.Add(Edge);
	}

	BRepBuilderAPI_MakeWire MakeWire;
	for (const auto& Edge : Edges)
	{
		MakeWire.Add(Edge);
	}
	MakeWire.Build();
	if (!MakeWire.IsDone())
	{
		return TopoDS_Wire();
	}
	TopoDS_Wire Wire = MakeWire.Wire();
	return Wire;
}

TArray<TopoDS_Wire> FGeomUtils::CreateWiresFromEdges(const TArray<TopoDS_Edge>& InEdges, double Tolerance)
{
	TArray<TopoDS_Wire> RetWires;

	Handle(TopTools_HSequenceOfShape) hEdges = new TopTools_HSequenceOfShape();
	Handle(TopTools_HSequenceOfShape) hWires = new TopTools_HSequenceOfShape();

	for (const auto& Edge : InEdges)
	{
		hEdges->Append(Edge);
	}
	ShapeAnalysis_FreeBounds::ConnectEdgesToWires(hEdges, Tolerance, Standard_False, hWires);
	for (int i = 1; i <= hWires->Length(); i++)
	{
		if (hWires->Value(i).ShapeType() != TopAbs_WIRE)
		{
			continue;
		}
		RetWires.Add(TopoDS::Wire(hWires->Value(i)));
	}
	return RetWires;
}

TopoDS_Wire FGeomUtils::CreateWireFromEdges(const TArray<TopoDS_Edge>& InEdges) {
	BRepBuilderAPI_MakeWire wireBuilder;
	for (const auto& edge : InEdges) {
		wireBuilder.Add(edge);
	}
	if (wireBuilder.IsDone())
	{
		return wireBuilder.Wire();
	}
	return TopoDS_Wire();
}

TopoDS_Edge FGeomUtils::CreateEdgeFromPoints(const FVector& InStartPos, const FVector& InEndPos)
{
	TopoDS_Vertex StartVertex = BRepBuilderAPI_MakeVertex(gp_Pnt(InStartPos.X, InStartPos.Y, InStartPos.Z));
	TopoDS_Vertex EndVertex = BRepBuilderAPI_MakeVertex(gp_Pnt(InEndPos.X, InEndPos.Y, InEndPos.Z));
	TopoDS_Edge Edge = BRepBuilderAPI_MakeEdge(StartVertex, EndVertex);
	return Edge;
}

TopoDS_Edge FGeomUtils::CreateEdgeFromVertexes(const TopoDS_Shape& InStartVertex, const TopoDS_Shape& InEndVertex)
{
	if (InStartVertex.ShapeType() != TopAbs_VERTEX || InEndVertex.ShapeType() != TopAbs_VERTEX)
	{
		return TopoDS_Edge();
	}
	return BRepBuilderAPI_MakeEdge(TopoDS::Vertex(InStartVertex), TopoDS::Vertex(InEndVertex));
}

TopoDS_Shape FGeomUtils::TransformShape(const TopoDS_Shape& InShape, const FTransform& Transform)
{
	if (InShape.IsNull())
	{
		return TopoDS_Shape();
	}
	if (Transform.Equals(FTransform::Identity))
	{
		return InShape;
	}
	gp_Trsf aTranslationTrsf;
	gp_Vec aTranslation(Transform.GetLocation().X, Transform.GetLocation().Y, Transform.GetLocation().Z);
	FQuat aRotation = Transform.GetRotation();
	gp_Quaternion aRotationQuat(aRotation.X, aRotation.Y, aRotation.Z, aRotation.W);
	aTranslationTrsf.SetRotationPart(aRotationQuat);
	aTranslationTrsf.SetTranslationPart(aTranslation);
	
	//SetScale
	FVector Scale3D = Transform.GetScale3D();
	aTranslationTrsf.SetScaleFactor(Scale3D.GetMin());
	
	BRepBuilderAPI_Transform aBRepTrsf(InShape, aTranslationTrsf);
	return aBRepTrsf.Shape();
}

Handle(Geom_Geometry) FGeomUtils::TransformGeometry(const Handle(Geom_Geometry)& InGeometry, const FTransform& Transform)
{
	if (InGeometry.IsNull())
	{
		return nullptr;
	}
	
	// 创建变换对象
	gp_Trsf aTrsf;
	
	// 设置平移部分
	gp_Vec aTranslation(Transform.GetLocation().X, Transform.GetLocation().Y, Transform.GetLocation().Z);
	aTrsf.SetTranslationPart(aTranslation);
	
	// 设置旋转部分
	FQuat aRotation = Transform.GetRotation();
	gp_Quaternion aRotationQuat(aRotation.X, aRotation.Y, aRotation.Z, aRotation.W);
	aTrsf.SetRotationPart(aRotationQuat);
	
	// 设置缩放部分
	FVector Scale3D = Transform.GetScale3D();
	aTrsf.SetScaleFactor(Scale3D.GetMin());
	
	// 创建几何对象的副本并应用变换
	Handle(Geom_Geometry) Result = InGeometry->Copy();
	Result->Transform(aTrsf);
	
	return Result;
}

TopoDS_Shape FGeomUtils::Reshape(const TopoDS_Shape& InShape, const TArray<TPair<TopoDS_Shape, TopoDS_Shape>>& ReplaceContent)
{
	// 创建一个BRepTools_ReShape对象
	ShapeBuild_ReShape Reshaper;
	for (auto CurReplaceItem : ReplaceContent)
	{
		if (CurReplaceItem.Key.Orientation() != CurReplaceItem.Value.Orientation())
		{
			CurReplaceItem.Value.Reverse();
		}

		Reshaper.Replace(CurReplaceItem.Key, CurReplaceItem.Value); // 记录替换请求
	}
	TopoDS_Shape ReplacedShape =  Reshaper.Apply(InShape);

	if (!IsEdgeOfShapeValid(ReplacedShape))
	{
		UE_LOG(LogTemp, Warning, TEXT("FGeomUtils::Edge invalid"));
	}
	//if (!IsFaceOfShapeValid(ReplacedShape))
	//{
	//	return FixFace(ReplacedShape);
	//}

	Standard_Integer aa = Reshaper.Status(InShape, ReplacedShape);
	UE_LOG(LogTemp, Warning, TEXT("FGeomUtils::Reshape:%i"), aa);
	return ReplacedShape;
}

TopoDS_Shape FGeomUtils::ReplaceVertexOfEdge(const TopoDS_Shape& InEdge, const TopoDS_Shape& InEdgeVertex, const TopoDS_Shape& InReplaceVertex)
{
	if (InEdge.ShapeType() != TopAbs_EDGE || InEdgeVertex.ShapeType() != TopAbs_VERTEX || InReplaceVertex.ShapeType() != TopAbs_VERTEX)
	{
		return TopoDS_Shape();
	}
	TArray<TPair<TopoDS_Shape, TopoDS_Shape>> ReplaceContent;
	TPair<TopoDS_Shape, TopoDS_Shape> ReplaceItem(InEdgeVertex, InReplaceVertex);
	ReplaceContent.Add(ReplaceItem);
	TopoDS_Shape ReplacedShape = Reshape(InEdge, ReplaceContent);
	return ReplacedShape;
}

bool FGeomUtils::IsShapeTypeOfShapeValid(const TopoDS_Shape& InShape, TopAbs_ShapeEnum InShapeType)
{
	if (InShape.IsNull())
	{
		return false;
	}
	BRepCheck_Analyzer analyzer(InShape);
	if (!analyzer.IsValid())
	{
		TopTools_IndexedMapOfShape FaceMap;
		TopExp::MapShapes(InShape, InShapeType, FaceMap);

		for (int i = 1; i <= FaceMap.Extent(); i++)
		{
			const Handle(BRepCheck_Result)& checkResult = analyzer.Result(FaceMap(i));
			if (checkResult.IsNull())
			{
				continue;
			}

			for (BRepCheck_ListIteratorOfListOfStatus it(checkResult->Status()); it.More(); it.Next())
			{
				BRepCheck_Status status = it.Value();
				if (status != BRepCheck_NoError) {
					UE_LOG(LogTemp, Warning, TEXT("ShapeType%d has an error:%d"), InShapeType, status);
					return false;
				}
			}
		}
	}
	return true;
}

bool FGeomUtils::IsEdgeOfShapeValid(const TopoDS_Shape& InShape)
{
	return IsShapeTypeOfShapeValid(InShape, TopAbs_EDGE);
}

bool FGeomUtils::IsFaceOfShapeValid(const TopoDS_Shape& InShape)
{
	return IsShapeTypeOfShapeValid(InShape, TopAbs_FACE);
}

TopoDS_Shape FGeomUtils::FixFace(const TopoDS_Shape& InFace)
{
	if (InFace.ShapeType() != TopAbs_FACE)
	{
		return TopoDS_Shape();
	}

	const TopoDS_Face& Face = TopoDS::Face(InFace);
	Handle(ShapeFix_Face) FaceFixer = new ShapeFix_Face(Face);
	bool bFixed = FaceFixer->Perform();
	return FaceFixer->Face();

}

bool FGeomUtils::GetEdgesConnectedToVertex(const TopoDS_Shape& InShape, const TopoDS_Shape& InVertex, TArray<TopoDS_Edge>& OutEdges)
{
	if (InVertex.ShapeType() != TopAbs_VERTEX || InShape.IsNull())
	{
		return false;
	}
	TopTools_IndexedMapOfShape EdgeMap;
	TopExp::MapShapes(InShape, TopAbs_EDGE, EdgeMap);
	for (int i = 1; i <= EdgeMap.Extent(); i++)
	{
		const TopoDS_Edge& Edge = TopoDS::Edge(EdgeMap(i));
		if (TopExp::FirstVertex(Edge).IsSame(InVertex) || TopExp::LastVertex(Edge).IsSame(InVertex))
		{
			OutEdges.Add(Edge);
		}
	}
	return true;
}

void FGeomUtils::ComputeParallelLineSegmentPassingThroughPoint(const FVector& InStartPos, const FVector& InEndPos, const FVector& InPassingThroughPos, FVector& OutStartPos, FVector& OutEndPos)
{
	FVector OutProjectedPos;
	FVector TranslateDir = FVector::ZeroVector;
	if (GetProjectionOnLine(InPassingThroughPos, InStartPos, InEndPos, OutProjectedPos))
	{
		TranslateDir = InPassingThroughPos - OutProjectedPos;
	}
	OutStartPos = InStartPos + TranslateDir;
	OutEndPos = InEndPos + TranslateDir;
}

bool FGeomUtils::GetProjectionOnLineSegment(const FVector& InPos, const FVector& InLineStartPos, const FVector& InLineEndPos, FVector& OutProjectedPos)
{
	gp_Pnt aStartPos(InLineStartPos.X, InLineStartPos.Y, InLineStartPos.Z);
	gp_Pnt aEndPos(InLineEndPos.X, InLineEndPos.Y, InLineEndPos.Z);
	gp_Pnt aPos(InPos.X, InPos.Y, InPos.Z);

	if (aStartPos.IsEqual(aEndPos, FPrecision::Epsilon()))
	{
		return false;
	}
	Handle(Geom_Line) line = new Geom_Line(aStartPos, gp_Vec(aStartPos, aEndPos));

	// 创建投影点对象
	GeomAPI_ProjectPointOnCurve projector(aPos, line);

	// 获取投影点
	if (projector.NbPoints() > 0)
	{
		gp_Pnt projectedPoint = projector.Point(1);
		OutProjectedPos = FVector(projectedPoint.X(), projectedPoint.Y(), projectedPoint.Z());
		if (IsPointInLineSegment(OutProjectedPos, InLineStartPos, InLineEndPos))
		{
			return true;
		}
	}
	return false;
}

bool FGeomUtils::GetProjectionOnLine(const FVector& InPos, const FVector& InLineStartPos, const FVector& InLineEndPos, FVector& OutProjectedPos)
{
	if (InLineStartPos.Equals(InLineEndPos, FPrecision::Confusion()) || InLineStartPos.ContainsNaN() || InLineEndPos.ContainsNaN())
		return false;

	gp_Pnt aStartPos(InLineStartPos.X, InLineStartPos.Y, InLineStartPos.Z);
	gp_Pnt aEndPos(InLineEndPos.X, InLineEndPos.Y, InLineEndPos.Z);
	gp_Pnt aPos(InPos.X, InPos.Y, InPos.Z);	

	Handle(Geom_Line) line = new Geom_Line(aStartPos, gp_Vec(aStartPos, aEndPos));

	// 创建投影点对象
	GeomAPI_ProjectPointOnCurve projector(aPos, line);

	// 获取投影点
	if (projector.NbPoints() > 0)
	{
		gp_Pnt projectedPoint = projector.Point(1);
		OutProjectedPos = FVector(projectedPoint.X(), projectedPoint.Y(), projectedPoint.Z());
		return true;
	}
	return false;
}

bool FGeomUtils::IsPointInLineSegment(const FVector& InPos, const FVector& InLineStartPos, const FVector& InLineEndPos, float Tolerance, float AngleTolerance)
{
	if ((InPos - InLineStartPos).IsNearlyZero(Tolerance))
		return true;
	if ((InPos - InLineEndPos).IsNearlyZero(Tolerance))
		return true;

	FVector direction0 = (InLineStartPos - InPos).GetSafeNormal();
	FVector direction1 = (InLineEndPos - InPos).GetSafeNormal();
	float X0 = FMath::Abs(direction0.X);
	float Y0 = FMath::Abs(direction0.Y);
	float Z0 = FMath::Abs(direction0.Z);
	float X1 = FMath::Abs(direction1.X);
	float Y1 = FMath::Abs(direction1.Y);
	float Z1 = FMath::Abs(direction1.Z);
	if (FMath::IsNearlyEqual(X0, X1, AngleTolerance) && FMath::IsNearlyEqual(Y0, Y1, AngleTolerance) && FMath::IsNearlyEqual(Z0, Z1, AngleTolerance))
	{
	//	return true;

		if (FMath::Min(InLineStartPos.X, InLineEndPos.X) - Tolerance <= InPos.X &&
			InPos.X - Tolerance <= FMath::Max(InLineStartPos.X, InLineEndPos.X) &&
			FMath::Min(InLineStartPos.Y, InLineEndPos.Y) - Tolerance <= InPos.Y &&
			InPos.Y - Tolerance <= FMath::Max(InLineEndPos.Y, InLineStartPos.Y) &&
			FMath::Min(InLineStartPos.Z, InLineEndPos.Z) - Tolerance <= InPos.Z &&
			InPos.Z - Tolerance <= FMath::Max(InLineEndPos.Z, InLineStartPos.Z))
			return true;
	}
	return false;
}

TopoDS_Compound FGeomUtils::MakeCompoundShape(const TArray<TopoDS_Shape>& InShapes)
{
	if (InShapes.Num() == 0)
	{
		return TopoDS_Compound();
	}

	BRep_Builder Builder;
	TopoDS_Compound Compound;
	Builder.MakeCompound(Compound);
	for (auto CurShape : InShapes)
	{
		if (CurShape.IsNull())
		{
			continue;
		}
		Builder.Add(Compound, CurShape);
	}
	return Compound;
}

TopoDS_Vertex FGeomUtils::MakeVertex(const FVector& InPos)
{
	gp_Pnt point(InPos.X, InPos.Y, InPos.Z);
	BRepBuilderAPI_MakeVertex MakeVertex(point);
	return MakeVertex.Vertex();
}

TopoDS_Edge FGeomUtils::MakeEdge(const FVector& InStartPos, const FVector& InEndPos)
{
	gp_Pnt startPoint(InStartPos.X, InStartPos.Y, InStartPos.Z);
	gp_Pnt endPoint(InEndPos.X, InEndPos.Y, InEndPos.Z);
	BRepBuilderAPI_MakeEdge MakeEdge(startPoint, endPoint);
	return MakeEdge.Edge();
}

TopoDS_Face FGeomUtils::MakeFaceFromTwoEdges(const TopoDS_Edge& InEdge1, const TopoDS_Edge& InEdge2)
{
	FVector start1, end1, start2, end2;
	bool bTakeAccountEdgeOrient = true;

	if (!FGeomUtils::GetEdgeStartAndEnd(InEdge1, start1, end1, bTakeAccountEdgeOrient) ||
		!FGeomUtils::GetEdgeStartAndEnd(InEdge2, start2, end2, bTakeAccountEdgeOrient))
	{
		throw std::runtime_error("Failed to get edge start and end points.");
	}

	BRepBuilderAPI_MakeWire wireBuilder;
	wireBuilder.Add(InEdge1);
	wireBuilder.Add(InEdge2);

	if (FVector::Dist(end1, start2) > FPrecision::Confusion())
	{
		TopoDS_Edge connectEdge1 = BRepBuilderAPI_MakeEdge(gp_Pnt(end1.X, end1.Y, end1.Z), gp_Pnt(start2.X, start2.Y, start2.Z));
		wireBuilder.Add(connectEdge1);
	}
	if (FVector::Dist(end2, start1) > FPrecision::Confusion())
	{
		TopoDS_Edge connectEdge2 = BRepBuilderAPI_MakeEdge(gp_Pnt(end2.X, end2.Y, end2.Z), gp_Pnt(start1.X, start1.Y, start1.Z));
		wireBuilder.Add(connectEdge2);
	}

	if (!wireBuilder.IsDone())
	{
		return TopoDS_Face();
	}

	TopoDS_Wire wire = wireBuilder.Wire();

	BRepBuilderAPI_MakeFace faceBuilder(wire);

	if (!faceBuilder.IsDone())
	{
		return TopoDS_Face();
	}

	return faceBuilder.Face();
}

TopoDS_Face FGeomUtils::MakeRectangle(float Length, float Width)
{
	gp_Pnt pnt(0.0, 0.0, 0.0);
	gp_Dir dir(0.0, 0.0, 1.0);
	Handle(Geom_Plane) aPlane = new Geom_Plane(pnt, dir);
	BRepBuilderAPI_MakeFace MakeFace(aPlane, 0.0, Length, 0.0, Width, FPrecision::Confusion());
	if (!MakeFace.IsDone())
	{
		return TopoDS_Face();
	}
	return MakeFace.Face();
}

TopoDS_Wire FGeomUtils::MakeCircleWire(float Radius)
{
	gp_Pnt center(0, 0, 0); // 圆心坐标
	gp_Dir normal(0, 0, 1); // 法向量方向（Z轴）

	Handle(Geom_Circle) circle = GC_MakeCircle(center, normal, Radius).Value();
	BRepBuilderAPI_MakeEdge MakeEdge(circle);
	if (!MakeEdge.IsDone())
	{
		return TopoDS_Wire();
	}
	BRepBuilderAPI_MakeWire MakeWire(MakeEdge.Edge());
	if (!MakeEdge.IsDone())
	{
		return TopoDS_Wire();
	}
	return MakeWire.Wire();
}

TopoDS_Face FGeomUtils::MakeCircleFace(float Radius)
{
	TopoDS_Wire CircleWire = FGeomUtils::MakeCircleWire(Radius);
	if (CircleWire.IsNull())
	{
		return TopoDS_Face();
	}
	BRepBuilderAPI_MakeFace MakeFace(CircleWire);
	if (!MakeFace.IsDone())
	{
		return TopoDS_Face();
	}
	return MakeFace.Face();
}

TopoDS_Shape FGeomUtils::MakeBox(float Length, float Width, float Height)
{
	BRepPrimAPI_MakeBox MakeBox(Length, Width, Height);
	MakeBox.Build();
	if (!MakeBox.IsDone())
	{
		return TopoDS_Shape();
	}
	return MakeBox.Shape();
}

TopoDS_Shape FGeomUtils::MakeCylinder(float Radius, float Height, float Angle)
{
	BRepPrimAPI_MakeCylinder MakeCylinder(Radius,Height,Angle);
	BRepPrim_Cylinder prim = MakeCylinder.Cylinder();
	TopoDS_Shape ResultShape = MakePad(Height, prim.BottomFace());
	return ResultShape;
}

TopoDS_Shape FGeomUtils::MakePad(float Height, const TopoDS_Face& ProfileFace)
{
	TopoDS_Shape OutShape;
	CreateSolidFromExtrusionOfProfileFaceShape(ProfileFace, FVector::ZAxisVector, OutShape);
	return OutShape;
}

TopoDS_Shape FGeomUtils::GetSection(const TopoDS_Shape& InShape, const FVector& InPlaneDir, const FVector& InPlanePos)
{
	TopoDS_Shape RetShape;
	gp_Pln Plane(gp_Pnt(InPlanePos.X, InPlanePos.Y, InPlanePos.Z), gp_Dir(InPlaneDir.X, InPlaneDir.Y, InPlaneDir.Z));
	BRepAlgoAPI_Section Section(InShape, Plane);
	Section.Approximation(Standard_True);

	if (!Section.IsDone())
	{
		return RetShape;
	}
	return Section.Shape();
}

TopoDS_Face FGeomUtils::MakeFaceFromClosedWire(const TopoDS_Wire& InWire)
{
	BRepBuilderAPI_MakeFace mkFace(InWire);
	if (mkFace.IsDone())
	{
		return mkFace.Face();
	}
	return TopoDS_Face();
}

TopoDS_Shape FGeomUtils::MakeFaceFromClosedWiresNoIsland(const TArray<TopoDS_Wire>& InWires)
{
	TopoDS_Shape RetShape;
	if (InWires.Num() == 0)
	{
		return RetShape;
	}
	TArray<TopoDS_Wire> SortedWires = InWires;
	SortedWires.Sort(CompareClosedWiresByBoundingBox);
	
	TArray<TopoDS_Wire> WireList = SortedWires;
	//for (int32 Index = SortedWires.Num() - 1; Index >= 0; --Index)
	//{
	//	WireList.Insert(SortedWires[Index], 0);
	//}

	// separate the wires into several independent faces
	TArray< TArray<TopoDS_Wire> > SeparatedWiresList;
	while (WireList.Num() > 0)
	{
		TArray<TopoDS_Wire> SepList;
		TopoDS_Wire Wire = WireList.Pop();
		SepList.Add(Wire);

		for (int32 i = 0; i < WireList.Num(); ++i)
		{
			if (IsInside(WireList[i], Wire))
			{
				SepList.Add(WireList[i]);
			}
		}
		for (auto& CurSep : SepList)
		{
			WireList.Remove(CurSep);
		}

		SeparatedWiresList.Add(SepList);
	}

	if (SeparatedWiresList.Num() == 1)
	{
		TArray<TopoDS_Wire>& Wires = SeparatedWiresList[0];
		return MakeFaceFromSeparatedWires(Wires);
	}
	else if (SeparatedWiresList.Num() > 1)
	{
		TopoDS_Compound Comp;
		BRep_Builder builder;
		builder.MakeCompound(Comp);
		for (auto& it : SeparatedWiresList) {
			TopoDS_Shape aFace = MakeFaceFromSeparatedWires(it);
			if (!aFace.IsNull())
				builder.Add(Comp, aFace);
		}

		return TopoDS_Shape(Comp);
	}
	else
	{
		return RetShape;
	}
}

TopoDS_Face FGeomUtils::MakeFaceFromSeparatedWires(const TArray<TopoDS_Wire>& InWires)
{
	if (InWires.Num() == 0)
	{
		return TopoDS_Face();
	}
	TArray<TopoDS_Wire> Wires = InWires;
	BRepBuilderAPI_MakeFace mkFace(InWires[0]);
	const TopoDS_Face& face = mkFace.Face();
	if (face.IsNull())
		return face;
	gp_Dir axis(0, 0, 1);
	BRepAdaptor_Surface FaceAdapt(face);
	if (FaceAdapt.GetType() == GeomAbs_Plane) {
		axis = FaceAdapt.Plane().Axis().Direction();
	}
	Wires.RemoveAt(0);
	for (auto Wire : Wires) {
		BRepBuilderAPI_MakeFace mkInnerFace(Wire);
		const TopoDS_Face& inner_face = mkInnerFace.Face();
		if (inner_face.IsNull())
			return inner_face; // failure
		gp_Dir inner_axis(0, 0, 1);
		BRepAdaptor_Surface adapt(inner_face);
		if (adapt.GetType() == GeomAbs_Plane) {
			inner_axis = adapt.Plane().Axis().Direction();
		}
		// It seems that orientation is always 'Forward' and we only have to reverse
		// if the underlying plane have opposite normals.
		if (axis.Dot(inner_axis) > 0)
			Wire.Reverse();
		mkFace.Add(Wire);
	}
	return mkFace.Face();
}

bool FGeomUtils::SplitFaceWithFace(const TopoDS_Shape& InTargetShape,
	const TArray<UGeomCurve*>& InSplittingEdges, TopoDS_Shape& OutTargetFace, TopoDS_Shape& OutSplittingFace)
{
	TArray<TopoDS_Edge> splittingEdges;
	for (const auto& curve : InSplittingEdges) {
		TopoDS_Shape edge = curve->ToShape();
		if (edge.ShapeType() != TopAbs_EDGE)
		{
			continue;
		}
		splittingEdges.Add(TopoDS::Edge(edge));
	}

	// Call the previously defined SplitFaceWithFace function
	return SplitFaceWithFace(InTargetShape, splittingEdges, OutTargetFace, OutSplittingFace);
}

bool FGeomUtils::SplitFaceWithFace(const TopoDS_Shape& InTargetShape, const TArray<TopoDS_Edge>& InSplittingEdges,
	TopoDS_Shape& OutTargetFace, TopoDS_Shape& OutSplittingFace)
{
	// Create the splitting face
	TopoDS_Wire splittingWire = CreateWireFromEdges(InSplittingEdges);
	TopoDS_Face splittingFace = BRepBuilderAPI_MakeFace(splittingWire);

	// Perform the section operation to find the intersection
	BRepAlgoAPI_Common sectionOperation(InTargetShape, splittingFace);
	if (!sectionOperation.IsDone()) {
		return false;
	}
	// Get the intersection shape
	TopoDS_Shape intersectionShape = sectionOperation.Shape();

	// Perform the cut operation to split the target face
	BRepAlgoAPI_Cut cutOperation(InTargetShape, splittingFace);
	if (!cutOperation.IsDone()) {
		return false;
	}

	// Set the output parameters
	OutTargetFace = cutOperation.Shape(); // The split target face
	OutSplittingFace = intersectionShape; // The intersection part

	return true;
}

bool FGeomUtils::CompareClosedWiresByBoundingBox(const TopoDS_Wire& InWire1, const TopoDS_Wire& InWire2)
{
	Bnd_Box box1, box2;
	if (!InWire1.IsNull()) {
		BRepBndLib::Add(InWire1, box1);
		box1.SetGap(0.0);
	}

	if (!InWire2.IsNull()) {
		BRepBndLib::Add(InWire2, box2);
		box2.SetGap(0.0);
	}

	return box1.SquareExtent() < box2.SquareExtent();
}

bool FGeomUtils::IsInside(const TopoDS_Wire& InWire1, const TopoDS_Wire& InWire2)
{
	Bnd_Box box1;
	BRepBndLib::Add(InWire1, box1);
	box1.SetGap(0.0);

	Bnd_Box box2;
	BRepBndLib::Add(InWire2, box2);
	box2.SetGap(0.0);

	if (box1.IsOut(box2))
		return false;

	double prec = Precision::Confusion();

	BRepBuilderAPI_MakeFace mkFace(InWire2);
	if (!mkFace.IsDone())
	{
		UE_LOG(LogTemp, Error, TEXT("Failed to create a face from wire."));
		return false;
	}
	TopoDS_Face face = ValidateFace(mkFace.Face());
	BRepAdaptor_Surface adapt(face);
	IntTools_FClass2d class2d(face, prec);
	Handle(Geom_Surface) surf = new Geom_Plane(adapt.Plane());
	ShapeAnalysis_Surface as(surf);

	TopExp_Explorer xp(InWire1, TopAbs_VERTEX);
	while (xp.More()) {
		TopoDS_Vertex v = TopoDS::Vertex(xp.Current());
		gp_Pnt p = BRep_Tool::Pnt(v);
		gp_Pnt2d uv = as.ValueOfUV(p, prec);
		if (class2d.Perform(uv) == TopAbs_IN)
			return true;
		else
			return false;
	}

	return false;
}

TopoDS_Face FGeomUtils::ValidateFace(const TopoDS_Face& InFace)
{
	BRepCheck_Analyzer aChecker(InFace);
	if (!aChecker.IsValid()) {
		TopoDS_Wire outerwire = ShapeAnalysis::OuterWire(InFace);
		TopTools_IndexedMapOfShape myMap;
		myMap.Add(outerwire);

		TopExp_Explorer xp(InFace, TopAbs_WIRE);
		ShapeFix_Wire FixWire;
		FixWire.SetFace(InFace);
		FixWire.Load(outerwire);
		FixWire.Perform();
		BRepBuilderAPI_MakeFace mkFace(FixWire.WireAPIMake());
		while (xp.More()) {
			if (!myMap.Contains(xp.Current())) {
				FixWire.Load(TopoDS::Wire(xp.Current()));
				FixWire.Perform();
				mkFace.Add(FixWire.WireAPIMake());
			}
			xp.Next();
		}
		if (mkFace.Face().IsNull())
		{
			return TopoDS_Face();
		}
		aChecker.Init(mkFace.Face());
		if (!aChecker.IsValid()) {
			ShapeFix_Shape fix(mkFace.Face());
			fix.SetPrecision(Precision::Confusion());
			fix.SetMaxTolerance(Precision::Confusion());
			fix.SetMaxTolerance(Precision::Confusion());
			fix.Perform();
			fix.FixWireTool()->Perform();
			fix.FixFaceTool()->Perform();
			if (fix.Shape().ShapeType() != TopAbs_FACE)
			{
				return InFace;
			}
			TopoDS_Face fixedFace = TopoDS::Face(fix.Shape());
			aChecker.Init(fixedFace);
			if (!aChecker.IsValid())
			{
				//Failed to validate broken face
				return InFace;
			}
			return fixedFace;
		}
		return mkFace.Face();
	}

	return InFace;
}

TopoDS_Wire FGeomUtils::MakeWireFromVerticesWithBulge(const TArray<FVertexWithBulge>& InVertices, bool bAutoLoop)
{
	BRepBuilderAPI_MakeWire aWireBuilder;
	int32 NumVertices = bAutoLoop ? InVertices.Num() : InVertices.Num() - 1;
	for (int32 i = 0; i < NumVertices; ++i)
	{
		const FVertexWithBulge& Vertex1 = InVertices[i];
		const FVertexWithBulge& Vertex2 = InVertices[(i + 1) % InVertices.Num()]; 

		gp_Pnt Point1(Vertex1.Position.X, Vertex1.Position.Y, Vertex1.Position.Z);
		gp_Pnt Point2(Vertex2.Position.X, Vertex2.Position.Y, Vertex2.Position.Z);


		if (Vertex1.Bulge != 0)
		{
			// 创建圆弧
			FLineWithBulge ArcLine(Vertex1, Vertex2);
			FVector CircleCenter = ArcLine.GetCenter();
			gp_Pnt Center(CircleCenter.X, CircleCenter.Y, 0);
			FVector ArcApex = ArcLine.GetArcApex();
			gp_Pnt MiddlePos(ArcApex.X, ArcApex.Y, 0);

			Handle(Geom_TrimmedCurve) Arc = GC_MakeArcOfCircle(Point1, MiddlePos, Point2).Value();
			TopoDS_Edge Edge = BRepBuilderAPI_MakeEdge(Arc);
			aWireBuilder.Add(Edge);
		}
		else
		{
			// 创建直线
			TopoDS_Edge Edge = BRepBuilderAPI_MakeEdge(Point1, Point2);
			aWireBuilder.Add(Edge);
		}
	}
	// 检查线框是否闭合
	if (!aWireBuilder.IsDone() || aWireBuilder.Wire().IsNull())
	{
		UE_LOG(LogTemp, Error, TEXT("Wire construction failed or Wire is null."));
	}

	return aWireBuilder.Wire();
}

TopoDS_Wire FGeomUtils::MakeWireFromCurves(const TArray<UGeomCurve*>& InCurves)
{
	BRepBuilderAPI_MakeWire aWireBuilder;
	for (UGeomCurve* Curve : InCurves)
	{
		Handle(Geom_Curve) InternelCurve = Handle(Geom_Curve)::DownCast(Curve->GetHandle());
		if (InternelCurve.IsNull())
			continue;
		TopoDS_Edge Edge = BRepBuilderAPI_MakeEdge(InternelCurve);
		if (Edge.IsNull())
		{
			continue;
		}
		aWireBuilder.Add(Edge);
	}
	if (aWireBuilder.IsDone())
	{
		return aWireBuilder.Wire();
	}
	return TopoDS_Wire();
}

bool FGeomUtils::AreCurvesConnected(UGeomCurve* GeomCurve1, UGeomCurve* GeomCurve2, float Tolerance)
{
	if (!GeomCurve1 || !GeomCurve2)
	{
		return false;
	}

	Handle(Geom_Curve) Curve1 = Handle(Geom_Curve)::DownCast(GeomCurve1->GetHandle());
	Handle(Geom_Curve) Curve2 = Handle(Geom_Curve)::DownCast(GeomCurve2->GetHandle());
	if (!Curve1 || !Curve1)
	{
		return false;
	}

	// Get the end point of Curve1
	Standard_Real firstCurveEndParam = Curve1->LastParameter();
	gp_Pnt firstCurveEndPoint;
	Curve1->D0(firstCurveEndParam, firstCurveEndPoint);

	// Get the start point of Curve2
	Standard_Real secondCurveStartParam = Curve2->FirstParameter();
	gp_Pnt secondCurveStartPoint;
	Curve2->D0(secondCurveStartParam, secondCurveStartPoint);

	// Check if the distance between the two points is within the tolerance
	return firstCurveEndPoint.Distance(secondCurveStartPoint) < Tolerance;
}


bool FGeomUtils::AreCurvesConnectedNoOrder(UGeomCurve* GeomCurve1, UGeomCurve* GeomCurve2, float Tolerance)
{
	if (!GeomCurve1 || !GeomCurve2)
	{
		return false;
	}

	Handle(Geom_Curve) Curve1 = Handle(Geom_Curve)::DownCast(GeomCurve1->GetHandle());
	Handle(Geom_Curve) Curve2 = Handle(Geom_Curve)::DownCast(GeomCurve2->GetHandle());
	if (!Curve1 || !Curve1)
	{
		return false;
	}

	// Get the first point of Curve1
	Standard_Real firstCurveStartParam = Curve1->FirstParameter();
	gp_Pnt firstCurveStartPoint;
	Curve1->D0(firstCurveStartParam, firstCurveStartPoint);

	// Get the end point of Curve1
	Standard_Real firstCurveEndParam = Curve1->LastParameter();
	gp_Pnt firstCurveEndPoint;
	Curve1->D0(firstCurveEndParam, firstCurveEndPoint);

	// Get the start point of Curve2
	Standard_Real secondCurveStartParam = Curve2->FirstParameter();
	gp_Pnt secondCurveStartPoint;
	Curve2->D0(secondCurveStartParam, secondCurveStartPoint);

	// Get the end point of Curve2
	Standard_Real secondCurveEndParam = Curve2->LastParameter();
	gp_Pnt secondCurveEndPoint;
	Curve2->D0(secondCurveEndParam, secondCurveEndPoint);

	// Check if the distance between the two points is within the tolerance
	return firstCurveStartPoint.Distance(secondCurveStartPoint) < Tolerance ||
		firstCurveEndPoint.Distance(secondCurveStartPoint) < Tolerance ||
		firstCurveStartPoint.Distance(secondCurveEndPoint) < Tolerance ||
		firstCurveEndPoint.Distance(secondCurveEndPoint) < Tolerance
		;
}

TArray<TopoDS_Wire> FGeomUtils::MakeIsolatedWireListFromCurves(const TArray<UGeomCurve*>& InCurves, float Tolerance)
{
	TArray<TopoDS_Wire> ResultWires;
	if (InCurves.Num() == 0)
	{
		return ResultWires;
	}
	BRepBuilderAPI_MakeWire aWireBuilder;
	UGeomCurve* PreviousCurve = nullptr;

	for (UGeomCurve* CurrentCurve : InCurves)
	{
		//Handle(Geom_Curve) CurrentCurve = Handle(Geom_Curve)::DownCast(Curve->GetHandle());
		Handle(Geom_Curve) Curve = Handle(Geom_Curve)::DownCast(CurrentCurve->GetHandle());
		if (!Curve)
			continue;

		TopoDS_Edge Edge = BRepBuilderAPI_MakeEdge(Curve);
		
		if (Edge.IsNull())
		{
			continue;
		}
		BRep_Builder Builder;
		Builder.UpdateEdge(Edge, Tolerance);
		TopoDS_Iterator it;
		for (it.Initialize(Edge); it.More(); it.Next()) {

			const TopoDS_Vertex& VE = TopoDS::Vertex(it.Value());

			Builder.UpdateVertex(VE, Tolerance);
		}
		if (!PreviousCurve || !AreCurvesConnectedNoOrder(PreviousCurve, CurrentCurve))
		{
			// If the current wire is not empty, add it to the list of wires
			if (aWireBuilder.IsDone() && !aWireBuilder.Wire().IsNull())
			{
				ResultWires.Add(aWireBuilder.Wire());
				aWireBuilder = BRepBuilderAPI_MakeWire(); // Start a new wire
			}
		}

		aWireBuilder.Add(Edge);
		PreviousCurve = CurrentCurve;
	}

	// Add the last wire if it's not empty
	if (aWireBuilder.IsDone() && !aWireBuilder.Wire().IsNull())
	{
		ResultWires.Add(aWireBuilder.Wire());
	}

	return ResultWires;
}

TArray<TArray<UGeomCurve*>> FGeomUtils::GetClosedCurvesListFromCurves(const TArray<UGeomCurve*>& InCurves)
{
	TArray<TArray<UGeomCurve*>> ClosedCurvesList;
	if (InCurves.Num() == 0)
	{
		return ClosedCurvesList;
	}

	TArray<UGeomCurve*> CurrentClosedCurve;
	UGeomCurve* FirstCurveInLoop = nullptr;
	UGeomCurve* PreviousCurve = nullptr;

	for (UGeomCurve* CurrentCurve : InCurves)
	{
		if (!CurrentCurve)
			continue;

		if (!PreviousCurve || !AreCurvesConnected(PreviousCurve, CurrentCurve))
		{
			// Check if the current set of curves forms a closed loop
			if (FirstCurveInLoop && AreCurvesConnected(PreviousCurve, FirstCurveInLoop))
			{
				ClosedCurvesList.Add(CurrentClosedCurve);
			}

			// Start a new potential closed loop
			CurrentClosedCurve.Empty();
			FirstCurveInLoop = CurrentCurve;
		}

		CurrentClosedCurve.Add(CurrentCurve);
		PreviousCurve = CurrentCurve;
	}

	// Final check for the last set of curves
	if (FirstCurveInLoop && AreCurvesConnected(PreviousCurve, FirstCurveInLoop))
	{
		ClosedCurvesList.Add(CurrentClosedCurve);
	}

	return ClosedCurvesList;
}

TArray<TArray<UGeomCurve*>> FGeomUtils::GetClosedCurvesListFromUnorderCurves(const TArray<UGeomCurve*>& InCurves)
{
	TArray<TArray<UGeomCurve*>> ClosedCurvesList;

	if (InCurves.Num() == 0)
	{
		return ClosedCurvesList;
	}

	TArray<UGeomCurve*> Curves = InCurves;

	// 移除重复的线 (重合或反向重合)
	RemoveRepeatedLines(Curves);

	// 排序
	TArray<UGeometryBase*> SortCurves;
	SortCurves.Append(Curves);
	SortCurves = FGeomUtils::BuildConnectedGeometryGroups(SortCurves);

	Curves.Empty();
	for (UGeometryBase* It : SortCurves)
		Curves.Add(Cast<UGeomCurve>(It));

	
	// 构建连接图
	TMap<UGeomCurve*, TArray<UGeomCurve*>> ConnectionMap;
	for (UGeomCurve* Curve1 : Curves)
	{
		for (UGeomCurve* Curve2 : Curves)
		{
			if (Curve1 != Curve2 && AreCurvesConnectedNoOrder(Curve1, Curve2, FPrecision::Confusion()))
			{
				ConnectionMap.FindOrAdd(Curve1).Add(Curve2);
			}
		}
	}

	UGeomCurve* MarkCurve = NewObject<UGeomCurve>();	// 标记线

	// 寻找闭合环
	for (int i = 0; i < Curves.Num(); ++i)
	{	
		// 判断是否需要计算
		bool bNeedCalc = true;		
		if (!ConnectionMap.Contains(Curves[i]) || ConnectionMap[Curves[i]].Num() < 1)
		{
			bNeedCalc = false;
		}
		else
		{
			TArray<UGeomCurve*> ConnectedCurve = ConnectionMap[Curves[i]];

			// 如果当前边和之前已经计算过的边相连，并且两条边的相邻边数量都是2，则两条边对应的封闭轮廓是一样的，不需要再次计算
			// 另一条边的相邻边数量是1的话，也不要计算了
			if (ConnectedCurve.Num() == 2)
			{				
				for (int j = 0; j < i; ++j)
				{
					if (ConnectedCurve.Contains(Curves[j]))
					{
						if (ConnectionMap.Contains(Curves[j]) && ConnectionMap[Curves[j]].Num() <= 2)
						{
							bNeedCalc = false;
							break;
						}
					}
				}
			}
		}

		if (!bNeedCalc)
			continue;


		// 计算
		TArray<UGeomCurve*> CurrentPath; 
		TArray<UGeomCurve*> Stack;
		Stack.Push(Curves[i]);
		//TODO 增加个深度判断，目前测试性能有问题

		while (Stack.Num() > 0)
		{
			UGeomCurve* CurrentCurve = Stack.Pop();

			while (CurrentCurve == MarkCurve)
			{
				if (Stack.Num() == 0)
				{
					CurrentCurve = nullptr;
					break;
				}

				CurrentCurve = Stack.Pop();
				CurrentPath.Pop();
			}

			if (!CurrentCurve)
				continue;

			if (CurrentPath.Contains(CurrentCurve))
				continue;

			CurrentPath.Add(CurrentCurve);
			Stack.Add(MarkCurve);

			if (!ConnectionMap.Contains(CurrentCurve) || ConnectionMap[CurrentCurve].Num() == 0)
				continue;

			for (UGeomCurve* ConnectedCurve : ConnectionMap[CurrentCurve])
			{
				if (ConnectedCurve == Curves[i])
				{
					// 找到一个闭合环
					if (CurrentPath.Num() > 2)
						ClosedCurvesList.Add(CurrentPath);
					else if (CurrentPath.Num() == 2 
						&& CurrentPath[0]->IsA<UGeomArcOfCircle>()
						&& CurrentPath[1]->IsA<UGeomArcOfCircle>())
					{
						ClosedCurvesList.Add(CurrentPath);
					}
				}
				else if (!CurrentPath.Contains(ConnectedCurve))
				{
					// 判断是否和前一个相连，过滤掉T型的错误区域
					if (CurrentPath.Num() >= 3)
					{
						if (ConnectionMap.Contains(ConnectedCurve))
						{
							if (ConnectionMap[ConnectedCurve].Contains(CurrentPath.Last(1)))
								continue;
						}
					}
					

					Stack.Push(ConnectedCurve);
				}
			}
		}
	}

	// 去除掉T字形的错误区域
	for (int i = ClosedCurvesList.Num() - 1; i >= 0; --i)
	{
		bool bInValid = false;

		if (ClosedCurvesList[i].Num() == 3)
		{
			if (!IsValidTriangle(ClosedCurvesList[i]))
				bInValid = true;
		}
		else if (ClosedCurvesList[i].Num() > 3)
		{
			int Num = ClosedCurvesList[i].Num();
			for (int j = 0; j < Num; ++j)
			{
				if (ConnectionMap.Find(ClosedCurvesList[i][j]) && ConnectionMap[ClosedCurvesList[i][j]].Contains(ClosedCurvesList[i][(j - 2 + Num) % Num]))
				{
					bInValid = true;
					break;
				}
			}
		}
		else if (ClosedCurvesList[i].Num() == 2)
		{
			bool bContainsArcs = false;
			if (ClosedCurvesList[i][0]->IsA<UGeomArcOfCircle>() && ClosedCurvesList[i][1]->IsA<UGeomArcOfCircle>())
			{
				bContainsArcs = true;
			}
			bInValid = !bContainsArcs;
		}
		else
		{
			bInValid = true;
		}

		if (bInValid)
			ClosedCurvesList.RemoveAt(i);
	}

	// 去掉重复的环
	for (int i = 0; i < ClosedCurvesList.Num(); ++i)
	{
		for (int j = ClosedCurvesList.Num() - 1; j > i; --j)
		{
			if (ClosedCurvesList[i].Num() == ClosedCurvesList[j].Num())
			{
				bool bHasNotContain = false;
				for (const UGeomCurve* CurveIt : ClosedCurvesList[j])
				{
					if (!ClosedCurvesList[i].Contains(CurveIt))
					{
						bHasNotContain = true;
						break;
					}
				}

				if (!bHasNotContain)
					ClosedCurvesList.RemoveAt(j);
			}
		}
	}

	return ClosedCurvesList;
}
// 半边数据结构
struct FHalfEdge
{
	UGeomCurve* Curve;
	FVector StartPoint;
	FVector EndPoint;
	bool bReversed;
	int32 StartVertexId;
	int32 EndVertexId;
	
	FHalfEdge(UGeomCurve* InCurve, const FVector& Start, const FVector& End, bool Reversed, int32 StartId, int32 EndId)
		: Curve(InCurve), StartPoint(Start), EndPoint(End), bReversed(Reversed), StartVertexId(StartId), EndVertexId(EndId) {}
};

// 顶点数据结构
struct FPlanarVertex
{
	FVector Position;
	TArray<int32> OutgoingHalfEdges; // 从该顶点出发的半边索引
	
	FPlanarVertex(const FVector& Pos) : Position(Pos) {}
};

TArray<TArray<UGeomCurve*>> FGeomUtils::FindLoopsFromCurves(const TArray<UGeomCurve*>& InCurves, float Tolerance)
{
	TArray<TArray<UGeomCurve*>> LoopsList;
	
	if (InCurves.Num() < 3)
	{
		return LoopsList;
	}
	
	// 1. 构建顶点表和半边表
	TArray<FPlanarVertex> Vertices;
	TArray<FHalfEdge> HalfEdges;
	TMap<FVector, int32> VertexMap; // 位置到顶点ID的映射
	
	for (UGeomCurve* Curve : InCurves)
	{
		if (!Curve)
			continue;
			
		FVector StartPoint, EndPoint;
		if (!GetCurveStartAndEndPoint(Curve, StartPoint, EndPoint))
			continue;
			
		// 查找或创建起点顶点
		int32 StartVertexId = -1;
		for (const auto& Pair : VertexMap)
		{
			if (FVector::Dist(Pair.Key, StartPoint) < Tolerance)
			{
				StartVertexId = Pair.Value;
				break;
			}
		}
		if (StartVertexId == -1)
		{
			StartVertexId = Vertices.Num();
			Vertices.Add(FPlanarVertex(StartPoint));
			VertexMap.Add(StartPoint, StartVertexId);
		}
		
		// 查找或创建终点顶点
		int32 EndVertexId = -1;
		for (const auto& Pair : VertexMap)
		{
			if (FVector::Dist(Pair.Key, EndPoint) < Tolerance)
			{
				EndVertexId = Pair.Value;
				break;
			}
		}
		if (EndVertexId == -1)
		{
			EndVertexId = Vertices.Num();
			Vertices.Add(FPlanarVertex(EndPoint));
			VertexMap.Add(EndPoint, EndVertexId);
		}
		
		// 跳过自环
		if (StartVertexId == EndVertexId)
			continue;
			
		// 创建两个半边（双向）
		int32 ForwardHalfEdgeId = HalfEdges.Num();
		HalfEdges.Add(FHalfEdge(Curve, StartPoint, EndPoint, false, StartVertexId, EndVertexId));
		Vertices[StartVertexId].OutgoingHalfEdges.Add(ForwardHalfEdgeId);
		
		int32 BackwardHalfEdgeId = HalfEdges.Num();
		HalfEdges.Add(FHalfEdge(Curve, EndPoint, StartPoint, true, EndVertexId, StartVertexId));
		Vertices[EndVertexId].OutgoingHalfEdges.Add(BackwardHalfEdgeId);
	}
	
	if (HalfEdges.Num() < 6) // 至少需要3条边，6个半边
	{
		return LoopsList;
	}
	
	// 2. 对每个顶点的出边按角度排序
	for (int32 VertexId = 0; VertexId < Vertices.Num(); ++VertexId)
	{
		FPlanarVertex& Vertex = Vertices[VertexId];
		if (Vertex.OutgoingHalfEdges.Num() < 2)
			continue;
			
		// 按角度排序
		Vertex.OutgoingHalfEdges.Sort([&](int32 EdgeId1, int32 EdgeId2) {
			const FHalfEdge& Edge1 = HalfEdges[EdgeId1];
			const FHalfEdge& Edge2 = HalfEdges[EdgeId2];
			
			FVector Dir1 = (Edge1.EndPoint - Edge1.StartPoint).GetSafeNormal();
			FVector Dir2 = (Edge2.EndPoint - Edge2.StartPoint).GetSafeNormal();
			
			float Angle1 = FMath::Atan2(Dir1.Y, Dir1.X);
			float Angle2 = FMath::Atan2(Dir2.Y, Dir2.X);
			
			// 确保角度在[0, 2π)范围内
			if (Angle1 < 0) Angle1 += 2 * PI;
			if (Angle2 < 0) Angle2 += 2 * PI;
			
			return Angle1 < Angle2;
		});
	}
	
	// 3. 使用右转优先策略找所有面
	TSet<int32> UsedHalfEdges;
	
	for (int32 StartHalfEdgeId = 0; StartHalfEdgeId < HalfEdges.Num(); ++StartHalfEdgeId)
	{
		if (UsedHalfEdges.Contains(StartHalfEdgeId))
			continue;
			
		TArray<UGeomCurve*> CurrentLoop;
		TArray<int32> LoopHalfEdges;
		
		int32 CurrentHalfEdgeId = StartHalfEdgeId;
		bool bValidLoop = true;
		
		do {
			if (UsedHalfEdges.Contains(CurrentHalfEdgeId))
			{
				bValidLoop = false;
				break;
			}
			
			const FHalfEdge& CurrentHalfEdge = HalfEdges[CurrentHalfEdgeId];
			CurrentLoop.Add(CurrentHalfEdge.Curve);
			LoopHalfEdges.Add(CurrentHalfEdgeId);
			
			// 防止无限循环
			if (CurrentLoop.Num() > HalfEdges.Num())
			{
				bValidLoop = false;
				break;
			}
			
			// 找到下一个半边（右转优先）
			int32 CurrentVertexId = CurrentHalfEdge.EndVertexId;
			const FPlanarVertex& CurrentVertex = Vertices[CurrentVertexId];
			
			if (CurrentVertex.OutgoingHalfEdges.Num() == 0)
			{
				bValidLoop = false;
				break;
			}
			
			// 找到当前半边的反向半边在出边列表中的位置
			int32 ReverseHalfEdgeId = -1;
			for (int32 i = 0; i < HalfEdges.Num(); ++i)
			{
				if (HalfEdges[i].StartVertexId == CurrentHalfEdge.EndVertexId && 
					HalfEdges[i].EndVertexId == CurrentHalfEdge.StartVertexId &&
					HalfEdges[i].Curve == CurrentHalfEdge.Curve)
				{
					ReverseHalfEdgeId = i;
					break;
				}
			}
			
			int32 ReversePosition = CurrentVertex.OutgoingHalfEdges.Find(ReverseHalfEdgeId);
			if (ReversePosition == INDEX_NONE)
			{
				bValidLoop = false;
				break;
			}
			
			// 选择下一条边（右转优先：逆时针方向的下一条边）
			int32 NextPosition = (ReversePosition + 1) % CurrentVertex.OutgoingHalfEdges.Num();
			CurrentHalfEdgeId = CurrentVertex.OutgoingHalfEdges[NextPosition];
			
		} while (CurrentHalfEdgeId != StartHalfEdgeId);
		
		// 验证并添加有效的环路
		if (bValidLoop && CurrentLoop.Num() >= 3 && CurrentHalfEdgeId == StartHalfEdgeId)
		{
			// 标记这些半边已被使用
			for (int32 HalfEdgeId : LoopHalfEdges)
			{
				UsedHalfEdges.Add(HalfEdgeId);
			}
			
			LoopsList.Add(CurrentLoop);
		}
	}
	
	return LoopsList;
}

TopoDS_Wire FGeomUtils::GetOffsetWire(const TArray<FVertexWithBulge>& InVertices, float InOffset)
{
	TopoDS_Shape OffsetShape;
	TopoDS_Wire Wire = MakeWireFromVerticesWithBulge(InVertices);
	BRepOffsetAPI_MakeOffset OffsetMaker(Wire, GeomAbs_Intersection);

	OffsetMaker.Perform(InOffset);
	if (OffsetMaker.IsDone())
	{
		OffsetShape = OffsetMaker.Shape();
		if (OffsetShape.ShapeType() == TopAbs_WIRE)
		{
			Wire = TopoDS::Wire(OffsetShape);
		}
	}
	return Wire;
}

TopoDS_Wire FGeomUtils::GetOffsetWire(const TopoDS_Wire& InWire, float InOffset)
{
	BRepOffsetAPI_MakeOffset offsetMaker(InWire, GeomAbs_Intersection);
	offsetMaker.Perform(InOffset);
	if (offsetMaker.IsDone() && offsetMaker.Shape().ShapeType() == TopAbs_WIRE)
	{
		return TopoDS::Wire(offsetMaker.Shape());
	}

	return TopoDS_Wire(); 
}

TopoDS_Wire FGeomUtils::GetOffsetWireFromWireList(const TArray<TArray<FVertexWithBulge>>& InVerticesList, float InOffset)
{
	TArray<TopoDS_Shape> RoomShapeList;
	for (auto& CurVertexes : InVerticesList)
	{
		TopoDS_Wire RoomWire = FGeomUtils::GetOffsetWire(CurVertexes, InOffset);
		TopoDS_Face RoomOffsetFace = FGeomUtils::MakeFaceFromClosedWire(RoomWire);
		if (RoomOffsetFace.IsNull())
		{
			continue;
		}
		RoomShapeList.Add(RoomOffsetFace);
	}

	TopoDS_Shape FusedRoomShape = FGeomUtils::FuseShapes(RoomShapeList);
	TArray<TopoDS_Wire> BoundsWires = FGeomUtils::GetShapeBoundWires(FusedRoomShape);
	if (BoundsWires.Num() == 0)
	{
		return TopoDS_Wire();
	}

	// 选择大的
	TArray<TopoDS_Wire> SortedWires = BoundsWires;
	SortedWires.Sort(FGeomUtils::CompareClosedWiresByBoundingBox);
	TopoDS_Wire ExternalRoomBoundWire = SortedWires.Last();
	return ExternalRoomBoundWire;
}

TopoDS_Wire FGeomUtils::GetOffsetWireFromCurveList(const TArray<TArray<UGeomCurve*>>& InCurvesList, float InOffset)
{
	TArray<TopoDS_Shape> RoomShapeList;
	for (auto& CurCurves : InCurvesList)
	{
		TopoDS_Wire RoomWire = FGeomUtils::MakeWireFromCurves(CurCurves);
		TopoDS_Wire RoomOffsetWire = FGeomUtils::GetOffsetWire(RoomWire, InOffset);
		TopoDS_Face RoomOffsetFace = FGeomUtils::MakeFaceFromClosedWire(RoomOffsetWire);
		if (RoomOffsetFace.IsNull())
		{
			continue;
		}
		RoomShapeList.Add(RoomOffsetFace);
	}

	TopoDS_Shape FusedRoomShape = FGeomUtils::FuseShapes(RoomShapeList);
	TArray<TopoDS_Wire> BoundsWires = FGeomUtils::GetShapeBoundWires(FusedRoomShape);
	if (BoundsWires.Num() == 0)
	{
		return TopoDS_Wire();
	}

	// 选择大的
	TArray<TopoDS_Wire> SortedWires = BoundsWires;
	SortedWires.Sort(FGeomUtils::CompareClosedWiresByBoundingBox);
	TopoDS_Wire ExternalRoomBoundWire = SortedWires.Last();
	return ExternalRoomBoundWire;
}

bool FGeomUtils::IsShapeClosed(const TopoDS_Shape& InShape)
{
	return BRep_Tool::IsClosed(InShape);
}

bool FGeomUtils::GetOffsetCurve(const TArray<FVertexWithBulge>& InVertices, float InOffset, TArray<UGeomCurve*>& OutCurves)
{
	TopoDS_Wire OffsetWire = FGeomUtils::GetOffsetWire(InVertices, InOffset);
	return GetGeomCurvesFromWire(OffsetWire, OutCurves);
}

TArray<TopoDS_Face> FGeomUtils::GenerateThickLineFaces(const TopoDS_Wire& InOriginalWire, const TopoDS_Wire& InOffsetWire)
{
	if (InOriginalWire.IsNull() || InOffsetWire.IsNull())
	{
		return TArray<TopoDS_Face>();
	}
	TArray<TopoDS_Face> faces;
	TopExp_Explorer offsetEdgeExp(InOffsetWire, TopAbs_EDGE);

	for (TopExp_Explorer edgeExp(InOriginalWire, TopAbs_EDGE); edgeExp.More(); edgeExp.Next())
	{
		TopoDS_Edge originalEdge = TopoDS::Edge(edgeExp.Current());

		// 找到对应的偏移边
		if (!offsetEdgeExp.More())
		{
			break; // 确保偏移边与原始边数量一致
		}
		TopoDS_Edge offsetEdge = TopoDS::Edge(offsetEdgeExp.Current());
		offsetEdgeExp.Next();

		// 创建连接原始边和偏移边端点的线段
		TopoDS_Vertex startVertex, endVertex, offsetStartVertex, offsetEndVertex;
		TopExp::Vertices(originalEdge, startVertex, endVertex);
		TopExp::Vertices(offsetEdge, offsetStartVertex, offsetEndVertex);

		TopoDS_Edge connectingEdge1 = BRepBuilderAPI_MakeEdge(startVertex, offsetStartVertex);
		TopoDS_Edge connectingEdge2 = BRepBuilderAPI_MakeEdge(endVertex, offsetEndVertex);

		// 创建封闭的线框
		BRepBuilderAPI_MakeWire closedWireMaker;
		closedWireMaker.Add(originalEdge);
		closedWireMaker.Add(connectingEdge1);
		closedWireMaker.Add(offsetEdge);
		closedWireMaker.Add(connectingEdge2);

		if (!closedWireMaker.IsDone())
		{
			continue; // 确保线框创建成功
		}

		TopoDS_Wire closedWire = closedWireMaker.Wire();

		// 创建一个面，填充封闭的线框
		BRepBuilderAPI_MakeFace faceMaker(closedWire);
		if (faceMaker.IsDone())
		{
			TopoDS_Face thickLineFace = faceMaker.Face();
			faces.Add(thickLineFace);
		}
	}

	return faces;
}

TArray<TopoDS_Face> FGeomUtils::GetThickLineFaceFromPath(const TArray<FVertexWithBulge>& InPathVertices, float InOffset)
{
	TopoDS_Wire originalWire = MakeWireFromVerticesWithBulge(InPathVertices);
	TopoDS_Wire offsetWire = GetOffsetWire(originalWire, InOffset);
	return GenerateThickLineFaces(originalWire, offsetWire);
}

TArray<TopoDS_Face> FGeomUtils::GetThickLineFaceFromPath(const TArray<UGeomCurve*>& InPathCurves, float InOffset)
{
	BRepBuilderAPI_MakeWire wireMaker;
	for (UGeomCurve* geomCurve : InPathCurves) 
	{
		if (!geomCurve)
		{
			continue;
		}
		TopoDS_Shape CurveShape = geomCurve->ToShape();
		if (CurveShape.IsNull() || CurveShape.ShapeType() != TopAbs_EDGE)
		{
			continue;
		}
		TopoDS_Edge edge = TopoDS::Edge(CurveShape);
		wireMaker.Add(edge);
	}
	if (!wireMaker.IsDone())
	{
		return TArray<TopoDS_Face>();
	}
	TopoDS_Wire originalWire = wireMaker.Wire();
	TopoDS_Wire offsetWire = GetOffsetWire(originalWire, InOffset);
	return GenerateThickLineFaces(originalWire, offsetWire);
}

TArray<TopoDS_Wire> FGeomUtils::GetShapeBoundWires(const TopoDS_Shape& InShape, float Tolerance)
{
	if (InShape.IsNull())
	{
		return TArray<TopoDS_Wire>();
	}
	TopoDS_Shape BoundsWire;
	if (InShape.ShapeType() == TopAbs_FACE)
	{
		BoundsWire = InShape;
	}
	else
	{
		ShapeAnalysis_FreeBounds BoundsAnalyzer(InShape, Tolerance);
		BoundsWire = BoundsAnalyzer.GetClosedWires();
	}
	TopTools_IndexedMapOfShape WireMap;
	TopExp::MapShapes(BoundsWire, TopAbs_WIRE, WireMap);
	TArray<TopoDS_Wire> RetWires;
	for (int32 i = 1; i <= WireMap.Extent(); i++)
	{
		TopoDS_Wire UnifiedWire = FGeomUtils::UnifyWire(WireMap(i));
		if (UnifiedWire.IsNull())
		{
			continue;
		}
		RetWires.Add(UnifiedWire);
	}
	return RetWires;
}

TopoDS_Wire FGeomUtils::GetFaceBoundWire(const TopoDS_Shape& InShape, float Tolerance)
{
	if (InShape.IsNull() || InShape.ShapeType() != TopAbs_FACE)
	{
		return TopoDS_Wire();
	}
	TopoDS_Face Face = TopoDS::Face(InShape);
	TopoDS_Wire FaceWire = BRepTools::OuterWire(Face);
	return FaceWire;
}

TopoDS_Wire FGeomUtils::UnifyWire(const TopoDS_Shape& InShape)
{
	if (InShape.IsNull() || InShape.ShapeType() != TopAbs_WIRE)
	{
		return TopoDS_Wire();
	}

	ShapeUpgrade_UnifySameDomain unify(InShape, true, false,false);
	unify.Build();

	if (unify.Shape().ShapeType() != TopAbs_WIRE)
	{
		return TopoDS_Wire();
	}
	return TopoDS::Wire(unify.Shape());
}

TopoDS_Shape FGeomUtils::FuseShapes(const TArray<TopoDS_Shape>& InShapes, float Tolerance)
{
	if (InShapes.Num() == 1)
	{
		return InShapes[0];
	}
	TopTools_ListOfShape ShapeList;
	for (const auto& Shape : InShapes) {
		ShapeList.Append(Shape);
	}

	BRepAlgoAPI_BuilderAlgo MakeFuseBuilder;
	MakeFuseBuilder.SetFuzzyValue(Tolerance);
	MakeFuseBuilder.SetArguments(ShapeList);
	MakeFuseBuilder.Build();
	if (!MakeFuseBuilder.IsDone())
	{
		return TopoDS_Compound();
	}
	TopoDS_Shape FusedShape =  MakeFuseBuilder.Shape();

	if (FusedShape.IsNull())
	{
		return TopoDS_Compound();
	}

	TopExp_Explorer Explorer(FusedShape, TopAbs_COMPOUND);
	if (!Explorer.More())
	{
		return TopoDS_Compound();
	}
	return TopoDS::Compound(Explorer.Current());
}

bool FGeomUtils::SewingShapes(const TArray<TopoDS_Shape>& InShapes, TopoDS_Shape& OutShape, float Tolerance)
{
	if (InShapes.Num() == 1)
		return false;

	BRepBuilderAPI_Sewing sewingTool(Tolerance);
	for (const TopoDS_Shape& shape : InShapes) 
	{
		sewingTool.Add(shape);
	}
	sewingTool.Perform();

	TopoDS_Shape SewedShape = sewingTool.SewedShape();
	if (SewedShape.IsNull())
		return false;

	OutShape = SewedShape;
	return true;
}

bool FGeomUtils::FuseMultipleShapes(const TArray<TopoDS_Shape>& InShapes, TopoDS_Shape& OutResultShape, float Tolerance)
{
	if (InShapes.Num() == 0)
	{
		return false;
	}

	if (InShapes.Num() == 1)
	{
		OutResultShape = InShapes[0];
		return true;
	}

	TopoDS_Shape FusedShape = InShapes[0];

	for (int32 i = 1; i < InShapes.Num(); ++i)
	{
		const TopoDS_Shape& CurrentShape = InShapes[i];

		BRepAlgoAPI_Fuse FuseOp(FusedShape, CurrentShape);
		FuseOp.SetFuzzyValue(Tolerance);
		FuseOp.Build();

		if (!FuseOp.IsDone())
		{
			return false;
		}

		FusedShape = FuseOp.Shape();

		// 每一步都进行统一域操作，防止拓扑干扰
		ShapeUpgrade_UnifySameDomain UnifyOp(FusedShape);
		UnifyOp.SetLinearTolerance(Tolerance);
		UnifyOp.Build();

		FusedShape = UnifyOp.Shape();
	}

	OutResultShape = FusedShape;
	return true;
}

TopoDS_Face FGeomUtils::ExtractSingleFaceIfValid(const TopoDS_Shape &SewedShape, bool bRequirePlane)
{
	TopTools_IndexedMapOfShape FaceMap;
	TopExp::MapShapes(SewedShape, TopAbs_FACE, FaceMap);

	if (FaceMap.Extent() == 1)
	{
		return TopoDS::Face(FaceMap(1));
	}
	else
	{
		return TopoDS_Face();
	}
}

TopoDS_Shape FGeomUtils::CutToolShapesFromBaseShape(const TopoDS_Shape& InBaseShape, const TArray<TopoDS_Shape>& InToolShapes, float Tolerance)
{
	TopTools_ListOfShape ShapeArguments, ShapeTools;
	ShapeArguments.Append(InBaseShape);
	for (const auto& Shape : InToolShapes) {
		ShapeTools.Append(Shape);
	}
	ShapeTools.Append(ShapeTools);
	TUniquePtr<BRepAlgoAPI_BooleanOperation> CutOperation = MakeUnique<BRepAlgoAPI_BooleanOperation>();
	CutOperation->SetArguments(ShapeArguments);
	CutOperation->SetTools(ShapeTools);
	CutOperation->SetFuzzyValue(Tolerance);
	CutOperation->Build();
	if (CutOperation->IsDone())
	{
		return CutOperation->Shape();
	}
	return TopoDS_Shape();
}

TopoDS_Shape FGeomUtils::CopyShape(const TopoDS_Shape& InShape)
{
	BRepBuilderAPI_Copy CopyTool(InShape);
	return CopyTool.Shape();
}

FTransform FGeomUtils::ConvertTo2D(const FTransform& Transform3D)
{
	FVector Translation2D(Transform3D.GetTranslation().X, Transform3D.GetTranslation().Y, 0.0f);
	FVector Scale2D(Transform3D.GetScale3D().X, Transform3D.GetScale3D().Y, 1.0f);
	FRotator Rotation2D(0.0f, Transform3D.GetRotation().Rotator().Yaw, 0.0f);
	return FTransform(Rotation2D, Translation2D, Scale2D);
}

bool FGeomUtils::AreShapesApproximatelyEqual(const TopoDS_Shape& InShape1, const TopoDS_Shape& InShape2, double Tolerance, double ToleraceProportion)
{
	if (InShape1.IsNull() || InShape2.IsNull())
		return false;

	BRepAlgoAPI_Common common(InShape1, InShape2);
	common.SetFuzzyValue(Tolerance);
	common.Build();
	if (!common.IsDone()) {
		return false;
	}

	TopoDS_Shape commonShape = common.Shape();

	// Step 2: Compare geometric properties
	GProp_GProps props1, props2, propsCommon;
	BRepGProp::VolumeProperties(InShape1, props1);
	BRepGProp::VolumeProperties(InShape2, props2);
	BRepGProp::VolumeProperties(commonShape, propsCommon);

	double volume1 = props1.Mass();
	double volume2 = props2.Mass();
	double volumeCommon = propsCommon.Mass();

	// Check if the volumes are approximately equal within the given tolerance
	if ((fabs(volume1 - volumeCommon) > Tolerance * 100 && fabs(volume1 - volumeCommon) / volume1 > ToleraceProportion)
		|| (fabs(volume2 - volumeCommon) > Tolerance * 100) && fabs(volume2 - volumeCommon) / volume2 > ToleraceProportion)
	{
		return false;
	}

	// Step 3: Compare centroids
	gp_Pnt centroid1 = props1.CentreOfMass();
	gp_Pnt centroid2 = props2.CentreOfMass();
	gp_Pnt centroidCommon = propsCommon.CentreOfMass();

	if (centroid1.Distance(centroidCommon) > Tolerance || centroid2.Distance(centroidCommon) > Tolerance) {
		return false;
	}

	return true;
}

bool FGeomUtils::AreFacesApproximatelyEqual(const TopoDS_Face& InFace1, const TopoDS_Face& InFace2, double Tolerance /*= FPrecision::Approximation()*/)
{
	BRepAlgoAPI_Common common(InFace1, InFace2);
	common.Build();
	if (!common.IsDone())
		return false;

	TopoDS_Shape commonShape = common.Shape();
	if (commonShape.IsNull())
		return false;

	// 计算各自面积
	GProp_GProps props1, props2, propsCommon;
	BRepGProp::SurfaceProperties(InFace1, props1);
	BRepGProp::SurfaceProperties(InFace2, props2);
	BRepGProp::SurfaceProperties(commonShape, propsCommon);

	double area1 = props1.Mass();
	double area2 = props2.Mass();
	double commonArea = propsCommon.Mass();

	return std::abs(area1 - commonArea) < Tolerance 
		&& std::abs(area2 - commonArea) < Tolerance;
}

auto Lambda_VertexWithBulgesEquals = [](
	const FVertexWithBulge& InParam1, 
	const FVertexWithBulge& InParam2, 
	float Tolerance = FPrecision::Confusion(), 
	float BulgeTolerance = FPrecision::BulgeConfusion()) -> bool
{
	return InParam1.Position.Equals(InParam2.Position, Tolerance) && FMath::IsNearlyEqual(FMath::Abs(InParam1.Bulge), FMath::Abs(InParam2.Bulge), BulgeTolerance);
};

bool FGeomUtils::AreEdgesEqualOutOfOrder(
	const TArray<TopoDS_Edge>& InEdges1,
	const TArray<TopoDS_Edge>& InEdges2,
	float Tolerance,
	float BulgeTolerance)
{
	if (InEdges1.Num() != InEdges2.Num())
	{
		return false;
	}

	TArray<bool> matched;
	matched.Init(false, InEdges2.Num());

	for (const TopoDS_Edge& edge1 : InEdges1)
	{
		bool foundMatch = false;

		FVertexWithBulge Start1;
		FVertexWithBulge End1;
		FGeomUtils::GetVertexWithBulgesFromEdge(edge1, Start1, End1);

		for (int32 i = 0; i < InEdges2.Num(); ++i)
		{
			if (matched[i])
			{
				continue;
			}

			const TopoDS_Edge& edge2 = InEdges2[i];

			FVertexWithBulge Start2;
			FVertexWithBulge End2;
			FGeomUtils::GetVertexWithBulgesFromEdge(edge2, Start2, End2);

			if ((Start1.Equals(Start2) && End1.Equals(End2))
				|| (Start1.Equals(End2) && End1.Equals(Start2)))
			{
				matched[i] = true;
				foundMatch = true;
				break;
			}
			
			if ((Lambda_VertexWithBulgesEquals(Start1, Start2) && Lambda_VertexWithBulgesEquals(End1, End2))
				|| (Lambda_VertexWithBulgesEquals(Start1, End2) && Lambda_VertexWithBulgesEquals(End1, Start2)))
			{
				matched[i] = true;
				foundMatch = true;
				break;
			}
		}

		if (!foundMatch)
		{
			return false;
		}
	}

	return true;
}

TArray<FVector> FGeomUtils::CalculateNewCornerPoints(const TArray<FVector>& CornerPoints, float AxisWidth, float AxisLength, const FVector& AxisWidthDirection, const FVector& AxisLengthDirection)
{
	if (FMath::IsNearlyEqual(AxisWidth, 0.f, 0.1f) || FMath::IsNearlyEqual(AxisLength, 0.f, 0.1f))
	{
		return CornerPoints;
	}

	TArray<FVector> NewCornerPoints;

	if (CornerPoints.Num() == 4)
	{
		auto FindStartingCorner = [&](const TArray<FVector>& Points) -> int {
			int StartingIndex = 0;
			float MinDotProduct = TNumericLimits<float>::Max();

			for (int i = 0; i < Points.Num(); ++i) {
				float Dot = FVector::DotProduct(Points[i], AxisWidthDirection) + FVector::DotProduct(Points[i], AxisLengthDirection);
				if (Dot < MinDotProduct) {
					MinDotProduct = Dot;
					StartingIndex = i;
				}
			}

			return StartingIndex;
			};

		// 找到起始角点
		int StartingIndex = FindStartingCorner(CornerPoints);
		FVector StartingCorner = CornerPoints[StartingIndex];

		// 计算新的角点
		NewCornerPoints.Add(StartingCorner);
		NewCornerPoints.Add(StartingCorner + AxisWidthDirection * AxisWidth);
		NewCornerPoints.Add(StartingCorner + AxisWidthDirection * AxisWidth + AxisLengthDirection * AxisLength);
		NewCornerPoints.Add(StartingCorner + AxisLengthDirection * AxisLength);

		if (CornerPoints.Num() > 4) {
			FVector ExtraCorner1 = StartingCorner + AxisLengthDirection * AxisLength - AxisWidthDirection * AxisWidth;
			FVector ExtraCorner2 = ExtraCorner1 - AxisLengthDirection * AxisLength;

			NewCornerPoints.Add(ExtraCorner1);
			NewCornerPoints.Add(ExtraCorner2);
		}
	}
	else if (CornerPoints.Num() == 6)	// 转角窗
	{
		int Num = 6;

		int OutCornerIndex = FBKMath::GetOutCornerIndex(CornerPoints, AxisWidthDirection, AxisLengthDirection);
		if (OutCornerIndex >= 0 && OutCornerIndex <= Num)
		{			
			NewCornerPoints.Init(FVector::ZeroVector, Num);
			int InnerCornerIndex = (OutCornerIndex + 3) % Num;

			NewCornerPoints[OutCornerIndex] = CornerPoints[OutCornerIndex];			// 外转角
			NewCornerPoints[InnerCornerIndex] = CornerPoints[InnerCornerIndex];		// 内转角

			float WidthOffset = 0.f, LengthOffset = 0.f;

			// 内转角前后两个点			
			int NextIndex = (InnerCornerIndex + 1) % Num;
			int PreIndex = (InnerCornerIndex - 1 + Num) % Num;
			FVector VNext = CornerPoints[NextIndex] - CornerPoints[InnerCornerIndex];
			FVector VPre = CornerPoints[PreIndex] - CornerPoints[InnerCornerIndex];
			float VNextLen = VNext.Size();
			float VPreLen = VPre.Size();
			VNext.Normalize();
			VPre.Normalize();

			if (VNext.Equals(AxisWidthDirection))
			{
				WidthOffset = AxisWidth - VNextLen;
				LengthOffset = AxisLength - VPreLen;

				NewCornerPoints[NextIndex] = CornerPoints[NextIndex] + AxisWidthDirection * WidthOffset;
				NewCornerPoints[PreIndex] = CornerPoints[PreIndex] + AxisLengthDirection * LengthOffset;
			}
			else
			{
				WidthOffset = AxisWidth - VPreLen;
				LengthOffset = AxisLength - VNextLen;

				NewCornerPoints[NextIndex] = CornerPoints[NextIndex] + AxisLengthDirection * LengthOffset;
				NewCornerPoints[PreIndex] = CornerPoints[PreIndex] + AxisWidthDirection * WidthOffset;
			}
			

			// 外转角前后两个点
			NextIndex = (OutCornerIndex + 1) % Num;
			PreIndex = (OutCornerIndex - 1 + Num) % Num;
			VNext = CornerPoints[NextIndex] - CornerPoints[OutCornerIndex];
			VPre = CornerPoints[PreIndex] - CornerPoints[OutCornerIndex];
			VNext.Normalize();
			VPre.Normalize();

			if (VNext.Equals(AxisWidthDirection))
			{
				NewCornerPoints[NextIndex] = CornerPoints[NextIndex] + AxisWidthDirection * WidthOffset;
				NewCornerPoints[PreIndex] = CornerPoints[PreIndex] + AxisLengthDirection * LengthOffset;
			}
			else
			{
				NewCornerPoints[NextIndex] = CornerPoints[NextIndex] + AxisLengthDirection * LengthOffset;
				NewCornerPoints[PreIndex] = CornerPoints[PreIndex] + AxisWidthDirection * WidthOffset;
			}
		}
	}
	else
	{
		NewCornerPoints = CornerPoints;
	}

	return NewCornerPoints;
}

// by AI
bool FGeomUtils::IsPointInOrOnPolygon2D(const FVector2D& InPoint, const TArray<FVector2D>& InPolygon, float Tolerance)
{
	int Num = InPolygon.Num();
	if (Num < 3)
		return false; // 至少需要 3 个点才能构成多边形

	bool bInside = false;

	for (int i = 0, j = Num - 1; i < Num; j = i++)
	{
		const FVector2D& P1 = InPolygon[i];
		const FVector2D& P2 = InPolygon[j];

		// 检查点是否在多边形的边上
		if (abs(InPoint.X - P1.X) < Tolerance && abs(InPoint.Y - P1.Y) < Tolerance)
			return true;
		if (abs(P1.Y - P2.Y) < Tolerance && abs(InPoint.Y - P1.Y) < Tolerance && InPoint.X >= min(P1.X, P2.X) && InPoint.X <= max(P1.X, P2.X))
			return true;
		if (abs(P1.X - P2.X) < Tolerance && abs(InPoint.X - P1.X) < Tolerance && InPoint.Y >= min(P1.Y, P2.Y) && InPoint.Y <= max(P1.Y, P2.Y))
			return true;

		// 检查射线与边的交点
		if ((P1.Y > InPoint.Y) != (P2.Y > InPoint.Y))
		{
			double IntersectX = (P2.X - P1.X) * (InPoint.Y - P1.Y) / (P2.Y - P1.Y) + P1.X;

			if (InPoint.X <= IntersectX)
			{
				bInside = !bInside;
			}
		}
	}

	return bInside;
}


bool FGeomUtils::IsPointInPolygon2D(const FVector2D& InPoint, const TArray<FVector2D>& InPolygon, float Tolerance)
{
	int Num = InPolygon.Num();
	if (Num < 3)
		return false; // 至少需要 3 个点才能构成多边形

	bool bInside = false;

	for (int i = 0, j = Num - 1; i < Num; j = i++)
	{
		const FVector2D& P1 = InPolygon[i];
		const FVector2D& P2 = InPolygon[j];

		// 检查射线与边的交点
		if ((P1.Y > InPoint.Y) != (P2.Y > InPoint.Y))
		{
			double IntersectX = (P2.X - P1.X) * (InPoint.Y - P1.Y) / (P2.Y - P1.Y) + P1.X;

			if (InPoint.X <= IntersectX)
			{
				bInside = !bInside;
			}
		}
	}

	return bInside;
}

bool FGeomUtils::IsPointInPolygon2D(const FVector& InPoint, const TArray<FVector>& InPolygon, float Tolerance)
{
	TArray<FVector2D> NewPolygon;
	for (const FVector& It : InPolygon)
		NewPolygon.Add(FVector2D(It));

	return IsPointInPolygon2D(FVector2D(InPoint), NewPolygon);
}


double FGeomUtils::Cross2D(const FVector2D& o, const FVector2D& a, const FVector2D& b)
{
	return (a.X - o.X) * (b.Y - o.Y) - (a.Y - o.Y) * (b.X - o.X);
}

// by AI
bool FGeomUtils::IsLineIntersect2D(const FVector2D& a1, const FVector2D& a2, const FVector2D& b1, const FVector2D& b2)
{
	double cross1 = Cross2D(a1, a2, b1);
	double cross2 = Cross2D(a1, a2, b2);
	double cross3 = Cross2D(b1, b2, a1);
	double cross4 = Cross2D(b1, b2, a2);

	// 判断是否相交
	if ((cross1 * cross2 < 0) && (cross3 * cross4 < 0))
	{
		return true;
	}

	return false;
}

// by AI
pair<bool, FVector2D> FGeomUtils::GetLineIntersectPoint(const FVector2D& a1, const FVector2D& a2, const FVector2D& b1, const FVector2D& b2)
{
	double A1 = a2.Y - a1.Y;
	double B1 = a1.X - a2.X;
	double C1 = A1 * a1.X + B1 * a1.Y;

	double A2 = b2.Y - b1.Y;
	double B2 = b1.X - b2.X;
	double C2 = A2 * b1.X + B2 * b1.Y;

	double det = A1 * B2 - A2 * B1;

	if (det == 0)
	{
		return { false, FVector2D() }; // 平行，无交点
	}

	double x = (B2 * C1 - B1 * C2) / det;
	double y = (A1 * C2 - A2 * C1) / det;

	// 检查交点是否在线段上
// 	if ((x >= min(a1.X, a2.X) && x <= max(a1.X, a2.X)) &&
// 		(y >= min(a1.Y, a2.Y) && y <= max(a1.Y, a2.Y)) &&
// 		(x >= min(b1.X, b2.X) && x <= max(b1.X, b2.X)) &&
// 		(y >= min(b1.Y, b2.Y) && y <= max(b1.Y, b2.Y))) {
// 		return { true, FVector2D(x, y) };

	if ((x - min(a1.X, a2.X) >= -0.0000001 && x - max(a1.X, a2.X) <= 0.000001) &&
		(y - min(a1.Y, a2.Y) >= -0.0000001 && y - max(a1.Y, a2.Y) <= 0.000001) &&
		(x - min(b1.X, b2.X) >= -0.0000001 && x - max(b1.X, b2.X) <= 0.000001) &&
		(y - min(b1.Y, b2.Y) >= -0.0000001 && y - max(b1.Y, b2.Y) <= 0.000001)) 
	{
		return { true, FVector2D(x, y) };
	}

	return { false, FVector2D() };
}

// by AI
TArray<FVector2D> FGeomUtils::GetLinePolygonIntersectPoints(const FVector2D& a1, const FVector2D& a2, const TArray<FVector2D>& polygon)
{
	TArray<FVector2D> IntersectPoints;

	for (size_t i = 0; i < polygon.Num(); ++i)
	{
		const FVector2D& b1 = polygon[i];
		const FVector2D& b2 = polygon[(i + 1) % polygon.Num()];

		if (IsLineIntersect2D(a1, a2, b1, b2)) 
		{
			auto result = GetLineIntersectPoint(a1, a2, b1, b2);
			if (result.first) 
			{
				IntersectPoints.Add(result.second);
			}
		}
	}

	return IntersectPoints;
}

TopoDS_Shape FGeomUtils::MakePipeShape(const TArray<FVertexWithBulge>& PathPoints, const TopoDS_Shape& ProfileShape)
{
	try {
		// 使用路径点创建Wire
		TopoDS_Wire PathWire = FGeomUtils::MakeWireFromVerticesWithBulge(PathPoints, false);
		if (PathWire.IsNull())
		{
			UE_LOG(LogTemp, Error, TEXT("路径Wire创建失败"));
			return TopoDS_Shape();
		}

		// 执行放样操作
		BRepOffsetAPI_MakePipe PipeMaker(PathWire, ProfileShape, GeomFill_IsCorrectedFrenet, true);

		if (PipeMaker.IsDone())
		{
			return PipeMaker.Shape();
		}
		else
		{
			UE_LOG(LogTemp, Error, TEXT("放样体创建失败"));
			return TopoDS_Shape();
		}
	}
	catch (const Standard_Failure& e) {
		UE_LOG(LogTemp, Error, TEXT("Open CASCADE exception: %s"), *FString(e.GetMessageString()));
		return TopoDS_Shape();
	}
	catch (const std::exception& e) {
		UE_LOG(LogTemp, Error, TEXT("Standard exception: %s"), *FString(e.what()));
		return TopoDS_Shape();
	}
	catch (...) {
		UE_LOG(LogTemp, Error, TEXT("An unknown error occurred."));
		return TopoDS_Shape();
	}
}

TopoDS_Shape FGeomUtils::MakePipeShape(const TopoDS_Wire& PathWire, const TopoDS_Shape& ProfileShape)
{
	try {
		BRepOffsetAPI_MakePipe PipeMaker(PathWire, ProfileShape, GeomFill_IsCorrectedFrenet, true);
		if (PipeMaker.IsDone())
		{
			return PipeMaker.Shape();
		}
		return TopoDS_Shape();
	}
	catch (const Standard_Failure& e) {
		UE_LOG(LogTemp, Error, TEXT("Open CASCADE exception: %s"), *FString(e.GetMessageString()));
		return TopoDS_Shape();
	}
	catch (const std::exception& e) {
		UE_LOG(LogTemp, Error, TEXT("Standard exception: %s"), *FString(e.what()));
		return TopoDS_Shape();
	}
	catch (...) {
		UE_LOG(LogTemp, Error, TEXT("An unknown error occurred."));
		return TopoDS_Shape();
	}
}

void FGeomUtils::GetFaceOutlineAndHoles(const TopoDS_Shape& InShape, TArray<FVertexWithBulge>& OutOutline, TArray<TArray<FVertexWithBulge>>& OutHoles)
{
    // 清空输出数组
    OutOutline.Empty();
    OutHoles.Empty();
    
    // 检查输入面是否有效
    if (InShape.IsNull())
    {
        return;
    }
    
    // 获取面的拓扑结构
    TopExp_Explorer Explorer;
    
    // 获取面的边界（外轮廓和内部洞）
    // 在OCCT中，面的边界由一系列的线环(wire)组成
    // 第一个线环通常是外轮廓，其余的是内部洞
    
    bool bFoundOuterWire = false;
    
    // 首先尝试获取外轮廓
    for (Explorer.Init(InShape, TopAbs_WIRE); Explorer.More(); Explorer.Next())
    {
        const TopoDS_Wire& Wire = TopoDS::Wire(Explorer.Current());
        
        // 检查这个线环是否是外轮廓
        if (!bFoundOuterWire)
        {
            // 提取外轮廓的点
            TArray<FVertexWithBulge> WirePoints;
            ExtractWirePoints(Wire, WirePoints);
            
            if (WirePoints.Num() > 0)
            {
                OutOutline = WirePoints;
                bFoundOuterWire = true;
            }
        }
        else
        {
            // 这是一个内部洞
            TArray<FVertexWithBulge> HolePoints;
            ExtractWirePoints(Wire, HolePoints);
            
            if (HolePoints.Num() > 0)
            {
                OutHoles.Add(HolePoints);
            }
        }
    }
    
    // 如果没有找到外轮廓，尝试使用BRep_Tool直接获取
    if (!bFoundOuterWire)
    {
        // 获取面的外轮廓
        TopoDS_Wire OuterWire = BRepTools::OuterWire(TopoDS::Face(InShape));
        if (!OuterWire.IsNull())
        {
            ExtractWirePoints(OuterWire, OutOutline);
        }
    }
}

void FGeomUtils::GetFaceOutlineAndHoles(const TopoDS_Shape& InShape, TArray<FVector>& OutOutline, TArray<TArray<FVector>>& OutHoles)
{
	TArray<FVertexWithBulge> Outline;
	TArray<TArray<FVertexWithBulge>> Holes;

	GetFaceOutlineAndHoles(InShape, Outline, Holes);

	OutOutline = DiscreteVerticesWithBulge(Outline);

	for (auto& HoleIt : Holes)
	{
		OutHoles.Add(DiscreteVerticesWithBulge(HoleIt));
	}
}

// 辅助方法：从线环(Wire)中提取点
void FGeomUtils::ExtractWirePoints(const TopoDS_Shape& InWire, TArray<FVertexWithBulge>& OutPoints, bool bIsLoop)
{
    if (InWire.IsNull())
    {
        return;
    }
    
    // 清空输出数组
    OutPoints.Empty();
    
    // 创建线环遍历器
    BRepTools_WireExplorer WireExplorer(TopoDS::Wire(InWire));
    if (!WireExplorer.More())
        return;
        
    // 处理第一条边
    const TopoDS_Edge& FirstEdge = WireExplorer.Current();
    FVertexWithBulge FirstStart, FirstEnd;
    GetVertexWithBulgesFromEdge(FirstEdge, FirstStart, FirstEnd);
    
    // 预先获取第二条边的信息来确定第一条边的方向
    WireExplorer.Next();
    bool bNeedReverseFirst = false;
    if (WireExplorer.More())
    {
        const TopoDS_Edge& SecondEdge = WireExplorer.Current();
        FVertexWithBulge SecondStart, SecondEnd;
        GetVertexWithBulgesFromEdge(SecondEdge, SecondStart, SecondEnd);
        
        // 如果第一条边的终点与第二条边的起点和终点都不匹配，需要翻转第一条边
        if (!FirstEnd.Position.Equals(SecondStart.Position, KINDA_SMALL_NUMBER) && 
            !FirstEnd.Position.Equals(SecondEnd.Position, KINDA_SMALL_NUMBER))
        {
            bNeedReverseFirst = true;
            // 交换起点和终点，并调整凸度值
            Swap(FirstStart, FirstEnd);
            FirstStart.Bulge = -FirstEnd.Bulge;
            FirstEnd.Bulge = 0;
        }
    }
    
    // 重置遍历器以便重新遍历
    WireExplorer.Init(TopoDS::Wire(InWire));
    WireExplorer.Next();  // 跳过第一条边，因为已经处理过了
    
    // 添加第一个点
    OutPoints.Add(FirstStart);
    FVertexWithBulge PrevEndVertex = FirstEnd;
    
    // 遍历后续边
    for (; WireExplorer.More(); WireExplorer.Next())
    {
        const TopoDS_Edge& Edge = WireExplorer.Current();
        FVertexWithBulge CurStart, CurEnd;
        GetVertexWithBulgesFromEdge(Edge, CurStart, CurEnd);
        
        // 如果当前边的起点与前一条边的终点匹配,直接添加起点
        if (CurStart.Position.Equals(PrevEndVertex.Position, KINDA_SMALL_NUMBER))
        {
            OutPoints.Add(CurStart);
            PrevEndVertex = CurEnd;
        }
        // 如果当前边的终点与前一条边的终点匹配,需要翻转边
        else if (CurEnd.Position.Equals(PrevEndVertex.Position, KINDA_SMALL_NUMBER))
        {
            // 翻转边时需要调整凸度值
            CurEnd.Bulge = -CurStart.Bulge;
            OutPoints.Add(CurEnd);
            PrevEndVertex = CurStart;
        }
    }
    
    // 添加最后一条边的终点（如果是闭环且不与起点重合）
    if (bIsLoop && !OutPoints[0].Position.Equals(PrevEndVertex.Position, KINDA_SMALL_NUMBER))
    {
        OutPoints.Add(PrevEndVertex);
    }
}

void FGeomUtils::SimplifyPolygon(const TArray<FVertexWithBulge>& InPoints, TArray<FVertexWithBulge>& OutPoints)
{
    // 如果输入点数组为空，直接返回
    if (InPoints.Num() == 0)
    {
        OutPoints.Empty();
        return;
    }
    
    // 如果只有一个点，直接添加到输出
    if (InPoints.Num() == 1)
    {
        OutPoints = InPoints;
        return;
    }
    
    // 清空输出数组
    OutPoints.Empty();

	// 清除重复点，只检查相邻点是否重复（因为重复点只会出现在相邻位置）
	TArray<FVertexWithBulge> UniquePoints;
	for (const FVertexWithBulge& Point : InPoints)
	{
		// 如果数组为空或当前点与最后一个点不同，则添加
		if (UniquePoints.Num() == 0 || !UniquePoints.Last().Position.Equals(Point.Position, KINDA_SMALL_NUMBER))
		{
			UniquePoints.Add(Point);
		}
	}
    
    // 移除近似共线的点
    if (UniquePoints.Num() >= 3)
    {
        // 添加第一个点
        OutPoints.Add(UniquePoints[0]);
        
        // 检查中间的点是否共线
        for (int32 i = 1; i < UniquePoints.Num() - 1; i++)
        {
            FVertexWithBulge Prev = UniquePoints[i-1];
            FVertexWithBulge Curr = UniquePoints[i];
            FVertexWithBulge Next = UniquePoints[i+1];
            
            // 计算向量
            FVector Vec1 = (Curr.Position - Prev.Position).GetSafeNormal();
            FVector Vec2 = (Next.Position - Curr.Position).GetSafeNormal();
            
            // 计算两个向量的点积，判断是否近似共线
            // 如果两个向量的点积接近1或-1，则三点近似共线
            float DotProduct = FVector::DotProduct(Vec1, Vec2);
            
            // 设置共线判断的阈值，可以根据需要调整
            const float CollinearThreshold = 0.999f; // 约等于1度的余弦值
            
            // 如果不共线，则保留当前点
            if (FMath::Abs(DotProduct) < CollinearThreshold)
            {
                OutPoints.Add(Curr);
            }
        }
        
        // 添加最后一个点
        OutPoints.Add(UniquePoints.Last());
    }
    else
    {
        // 如果点数少于3，则无法判断共线，直接使用去重后的点
        OutPoints = UniquePoints;
    }
    
}

FTransform FGeomUtils::ConvertTrsfToFTransform(const gp_Trsf& InTrsf)
{
	gp_XYZ translationXYZ = InTrsf.TranslationPart();
	FVector translation(translationXYZ.X(), translationXYZ.Y(), translationXYZ.Z());

	// 提取旋转
	gp_Quaternion rotationQuat;
	rotationQuat = InTrsf.GetRotation();
	FQuat rotation(rotationQuat.X(), rotationQuat.Y(), rotationQuat.Z(), rotationQuat.W());

	// 提取缩放
	gp_XYZ scaleXYZ = InTrsf.ScaleFactor() * gp_XYZ(1.0, 1.0, 1.0); // 假设统一缩放
	FVector scale(scaleXYZ.X(), scaleXYZ.Y(), scaleXYZ.Z());

	FTransform Transform(rotation, translation, scale);
	return Transform;
}

gp_Ax3 FGeomUtils::GetFaceCoordinateSystem(const TopoDS_Face& InFace)
{
	if (InFace.IsNull())
	{
		return gp_Ax3();
	}
	Handle(Geom_Surface) surface = BRep_Tool::Surface(InFace);
	Handle(Geom_Plane) plane = Handle(Geom_Plane)::DownCast(surface);
	if (!plane.IsNull()) {
		gp_Pln pln = plane->Pln();
		return pln.Position();
	}
	// 对于非平面情况，需要其他处理
	return gp_Ax3();
}

FTransform FGeomUtils::CalculateTransformationBetweenFaces(const TopoDS_Shape& InFace1, const TopoDS_Shape& InFace2)
{
	if (InFace1.ShapeType() != TopAbs_FACE || InFace2.ShapeType() != TopAbs_FACE)
	{
		return FTransform::Identity;
	}
	TopoDS_Face Face1 = TopoDS::Face(InFace1);
	TopoDS_Face Face2 = TopoDS::Face(InFace2);

	gp_Ax3 ax1 = GetFaceCoordinateSystem(Face1);
	gp_Ax3 ax2 = GetFaceCoordinateSystem(Face2);

	// Calculate the rotation needed to align the normals
	gp_Dir dir1 = ax1.Direction();
	gp_Dir dir2 = ax2.Direction();

	gp_Trsf rotationTransform;
	if (!dir1.IsParallel(dir2, Precision::Angular()))
	{
		gp_Vec rotationAxis = dir1.Crossed(dir2);
		double rotationAngle = dir1.Angle(dir2);
		rotationTransform.SetRotation(gp_Ax1(ax1.Location(), rotationAxis), rotationAngle);
	}

	// Apply rotation to ax1
	gp_Pnt transformedOrigin = ax1.Location().Transformed(rotationTransform);

	// Calculate translation to align the origins
	gp_Vec translation(transformedOrigin, ax2.Location());

	// Create the final transformation
	gp_Trsf transform;
	transform.SetRotationPart(rotationTransform.GetRotation());
	transform.SetTranslationPart(translation);

	FTransform RetTransform = ConvertTrsfToFTransform(transform).Inverse();
	return RetTransform;
}

bool FGeomUtils::AreFacesCoincident(const TopoDS_Shape& InFace1, const TopoDS_Shape& InFace2, double tolerance)
{
	if (InFace1.ShapeType() != TopAbs_FACE || InFace2.ShapeType() != TopAbs_FACE)
	{
		return false;
	}
	TopoDS_Face Face1 = TopoDS::Face(InFace1);
	TopoDS_Face Face2 = TopoDS::Face(InFace2);
	BRepAlgoAPI_Common common(Face1, Face2);
	common.Build();

	if (!common.IsDone()) {
		return false;
	}
	TopoDS_Shape commonShape = common.Shape();

	// 检查公共部分的面积是否接近于 face1 或 face2 的面积
	GProp_GProps props1, propsCommon;
	BRepGProp::SurfaceProperties(Face1, props1);
	BRepGProp::SurfaceProperties(commonShape, propsCommon);

	double area1 = props1.Mass();
	double areaCommon = propsCommon.Mass();

	return (areaCommon >= area1 - tolerance);
}

bool FGeomUtils::AreFaceCoincidentFaceOfShape(const TopoDS_Shape& InFace, const TopoDS_Shape& InShape, TopoDS_Face& OutFace, double tolerance)
{
	if (InFace.ShapeType() != TopAbs_FACE)
	{
		return false;
	}

	TopTools_IndexedMapOfShape faceMap;
	TopExp::MapShapes(InShape, TopAbs_FACE, faceMap);

	for (int i = 1; i <= faceMap.Extent(); ++i)
	{
		TopoDS_Face currentFace = TopoDS::Face(faceMap(i));
		if (AreFacesCoincident(InFace, currentFace, tolerance))
		{
			OutFace = currentFace;
			return true;
		}
	}
	return false;
}

FVector FGeomUtils::GetFaceNormal(const TopoDS_Shape& Face)
{
    // 基本有效性检查
    if (Face.IsNull() || Face.ShapeType() != TopAbs_FACE)
    {
        return FVector::ZeroVector;
    }

    TopoDS_Face OcctFace = TopoDS::Face(Face);

    // 取得参数范围，并取中心点作为采样点
    Standard_Real U1, U2, V1, V2;
    BRepTools::UVBounds(OcctFace, U1, U2, V1, V2);
    Handle(Geom_Surface) Surf = BRep_Tool::Surface(OcctFace);
    if (Surf.IsNull())
    {
        return FVector::ZeroVector;
    }

    Standard_Real U = (U1 + U2) * 0.5;
    Standard_Real V = (V1 + V2) * 0.5;

    // 使用 OCCT 提供的性质类直接计算法线
    GeomLProp_SLProps Props(Surf, U, V, 1, Precision::Confusion());
    if (!Props.IsNormalDefined())
    {
        return FVector::ZeroVector;
    }

    gp_Dir NormalDir = Props.Normal();

    // 如果面方向为 REVERSED，则翻转法线，确保与外向一致
    if (OcctFace.Orientation() == TopAbs_REVERSED)
    {
        NormalDir.Reverse();
    }

    gp_Vec NormalVec(NormalDir);
    return FVector(NormalVec.X(), NormalVec.Y(), NormalVec.Z()).GetSafeNormal();
}

FVector FGeomUtils::GetFaceMiddlePoint(const TopoDS_Shape& Face)
{
	if (Face.IsNull())
	{
		return FVector::ZeroVector;
	}
	if (Face.ShapeType() == TopAbs_FACE)
	{
		// 获取面的几何表面
		Handle(Geom_Surface) Surface = BRep_Tool::Surface(TopoDS::Face(Face));
		if (Surface.IsNull())
		{
			return FVector::ZeroVector;
		}
		// 获取参数域范围
		Standard_Real U1, U2, V1, V2;
		BRepTools::UVBounds(TopoDS::Face(Face), U1, U2, V1, V2);
		// 在参数域中心计算法线
		gp_Pnt P;
		gp_Vec D1U, D1V;
		Surface->D1((U1 + U2) / 2.0, (V1 + V2) / 2.0, P, D1U, D1V);
		
		// 计算法线向量（使用叉积）
		gp_Vec Normal = D1U.Crossed(D1V);
		return FVector(P.X(), P.Y(), P.Z());
	}

	// if (Face.ShapeType() == TopAbs_FACE)
	// {
	// 	TArray<FVertexWithBulge> WallVertices;
	// 	// 获取墙面孔洞
	// 	TArray<TArray<FVertexWithBulge>> Holes;
	// 	FGeomUtils::GetFaceOutlineAndHoles(Face, WallVertices, Holes);
	// 	// 计算中心点
	// 	FVector OutCenter;
	// 	OutCenter = FVector::ZeroVector;
	// 	for (const FVertexWithBulge& Vertex : WallVertices)
	// 	{
	// 		OutCenter += Vertex.Position;
	// 	}
	// 	OutCenter /= WallVertices.Num();
	// 	return OutCenter;
	// }

	// // 如果所有方法都失败，返回零向量
	return FVector::ZeroVector;
}

// 通过三点计算凸度值的辅助函数
float FGeomUtils::CalculateBulgeFromThreePoints(const FVector& Start, const FVector& Middle, const FVector& End)
{
    // 检查三点是否共线
    FVector Dir1 = (Middle - Start).GetSafeNormal();
    FVector Dir2 = (End - Middle).GetSafeNormal();
    
    if (FMath::Abs(FVector::DotProduct(Dir1, Dir2)) > 0.999f)
    {
        // 三点几乎共线，返回0凸度
        return 0.0f;
    }
    
    // 计算三点确定的圆
    // 使用行列式方法求解圆心
    float A1 = Start.X - Middle.X;
    float B1 = Start.Y - Middle.Y;
    float C1 = 0.5f * (FMath::Square(Start.X) - FMath::Square(Middle.X) + 
                        FMath::Square(Start.Y) - FMath::Square(Middle.Y));
                        
    float A2 = Middle.X - End.X;
    float B2 = Middle.Y - End.Y;
    float C2 = 0.5f * (FMath::Square(Middle.X) - FMath::Square(End.X) + 
                        FMath::Square(Middle.Y) - FMath::Square(End.Y));
                        
    float D = A1 * B2 - A2 * B1;
    
    // 如果行列式接近0，表示无法确定圆
    if (FMath::Abs(D) < SMALL_NUMBER)
    {
        return 0.0f;
    }
    
    // 计算圆心
    float CenterX = (C1 * B2 - C2 * B1) / D;
    float CenterY = (A1 * C2 - A2 * C1) / D;
    FVector Center(CenterX, CenterY, 0);
    
    // 计算半径
    float Radius = FVector::Distance(Center, Start);
    
    // 计算弦长
    float ChordLength = FVector::Distance(Start, End);
    
    // 计算弦高
    float SagHeight = 0.0f;
    
    // 计算圆心到弦的距离
    FVector ChordDir = (End - Start).GetSafeNormal();
    FVector ChordMid = (Start + End) * 0.5f;
    FVector CenterToChord = ChordMid - Center;
    float CenterToChordDist = FMath::Abs(FVector::CrossProduct(ChordDir, CenterToChord).Size());
    
    // 弦高 = 半径 - 圆心到弦的距离
    SagHeight = Radius - CenterToChordDist;
    
    // 计算凸度值 = 4 * 弦高 / 弦长
    float Bulge = 0.0f;
    if (ChordLength > SMALL_NUMBER)
    {
        Bulge = 4.0f * SagHeight / ChordLength;
    }
    
    // 确定凸度值的符号
    // 判断中间点是否在起点和终点连线的左侧
    FVector Cross = FVector::CrossProduct(End - Start, Middle - Start);
    if (Cross.Z < 0)
    {
        Bulge = -Bulge;
    }
    
    return Bulge;
}


TArray<FVector> FGeomUtils::DiscreteVerticesWithBulge(const TArray<FVertexWithBulge>& InVertices, float TessFactor)
{
	TArray<FVector> OutPoints;
	if (InVertices.Num() < 2)
	{
		return OutPoints;
	}

	// 遍历所有顶点，处理每一段
	for (int32 i = 0; i < InVertices.Num(); ++i)
	{
		const FVertexWithBulge& Vertex1 = InVertices[i];
		const FVertexWithBulge& Vertex2 = InVertices[(i + 1) % InVertices.Num()];
		if (Vertex1.Position.Equals(Vertex2.Position))
		{
			continue;
		}
		// 添加起始点
		OutPoints.Add(Vertex1.Position);

		// 如果有凸度，需要离散化圆弧
		if (FMath::Abs(Vertex1.Bulge) > FPrecision::BulgeConfusion())
		{
			FLineWithBulge ArcLine(Vertex1, Vertex2);
			FVector CircleCenter = ArcLine.GetCenter();
			float Radius = ArcLine.GetRadius();
			
			// 计算起始角度和结束角度
			float StartAngle = FMath::Atan2(Vertex1.Position.Y - CircleCenter.Y, Vertex1.Position.X - CircleCenter.X);
			float EndAngle = FMath::Atan2(Vertex2.Position.Y - CircleCenter.Y, Vertex2.Position.X - CircleCenter.X);
			
			// 确保角度范围正确
			if (EndAngle < StartAngle && Vertex1.Bulge > 0)
			{
				EndAngle += 2 * PI;
			}
			else if (EndAngle > StartAngle && Vertex1.Bulge < 0)
			{
				StartAngle += 2 * PI;
			}
			
			// 计算角度差和分段数
			float BulgeDir = Vertex1.Bulge > 0 ? 1.0 : -1.0;
			float DiffAngle = BulgeDir * (EndAngle - StartAngle);
			float Interval = FMath::Min(PI * 0.05f * TessFactor, DiffAngle * 0.1f); // 限制最大间隔
			int32 NumSegments = FMath::Max(2, FMath::CeilToInt(DiffAngle / Interval));
			
			// 计算角度步长
			float AngleStep = FMath::Abs((DiffAngle) / (float)NumSegments);
			float CurrentAngle = StartAngle;
			
			// 生成圆弧上的点
			for (int32 j = 1; j < NumSegments; j++)
			{
				CurrentAngle = StartAngle + BulgeDir * j * AngleStep;
				FVector ThisVertex = CircleCenter + 
					Radius * FVector(FMath::Cos(CurrentAngle), FMath::Sin(CurrentAngle), 0.0f);
				OutPoints.Add(ThisVertex);
			}
		}
	}

	
	return OutPoints;
}

TArray<FVector> FGeomUtils::DiscreteCurveWithBulge(UGeomTrimmedCurve* InCurve, float TessFactor)
{
	TArray<FVector> OutVector;

	UGeomArcOfCircle* ArcLine = Cast<UGeomArcOfCircle>(InCurve);
	
	float Bulge = 0.f;
	if (ArcLine)
		Bulge = ArcLine->GetBulge();

	FVertexWithBulge Start = FVertexWithBulge(InCurve->GetStartPoint(), Bulge);
	FVertexWithBulge End = FVertexWithBulge(InCurve->GetEndPoint(), Bulge);

	OutVector = DiscreteVerticesWithBulge({ Start, End }, TessFactor);

	return MoveTemp(OutVector);
}

// 构建连接边组
TArray<TArray<TopoDS_Edge>> FGeomUtils::BuildConnectedEdgeGroups(const TArray<TopoDS_Edge>& SuitableEdges)
{
	TArray<TArray<TopoDS_Edge>> ConnectedEdgeGroups;
	TArray<bool> EdgeProcessed;
	EdgeProcessed.Init(false, SuitableEdges.Num());

	// 构建起点和终点到边索引的映射,用于快速查找连接
	TArray<TPair<FVector, TArray<int32>>> StartPointToEdgeIndices;
	TArray<TPair<FVector, TArray<int32>>> EndPointToEdgeIndices;
	const float ConnectionTolerance = 0.1f; // 毫米

	// 遍历所有边,建立映射关系
	for (int32 i = 0; i < SuitableEdges.Num(); i++)
	{
		FVector StartPoint, EndPoint;
		FGeomUtils::GetEdgeStartAndEnd(SuitableEdges[i], StartPoint, EndPoint, true);
		
		// 将边索引添加到映射中
		bool bAddedToStart = false;
		bool bAddedToEnd = false;

		// 检查是否可以合并到现有的点
		for (auto& Pair : StartPointToEdgeIndices)
		{
			if (FVector::Distance(Pair.Key, StartPoint) < ConnectionTolerance)
			{
				Pair.Value.Add(i);
				bAddedToStart = true;
				break;
			}
		}
		if (!bAddedToStart)
		{
			TArray<int32> Indices;
			Indices.Add(i);
			StartPointToEdgeIndices.Add(TPair<FVector, TArray<int32>>(StartPoint, Indices));
		}

		for (auto& Pair : EndPointToEdgeIndices)
		{
			if (FVector::Distance(Pair.Key, EndPoint) < ConnectionTolerance)
			{
				Pair.Value.Add(i);
				bAddedToEnd = true;
				break;
			}
		}
		if (!bAddedToEnd)
		{
			TArray<int32> Indices;
			Indices.Add(i);
			EndPointToEdgeIndices.Add(TPair<FVector, TArray<int32>>(EndPoint, Indices));
		}
	}

	// 遍历所有边,构建连接组
	for (int32 i = 0; i < SuitableEdges.Num(); i++)
	{
		if (EdgeProcessed[i])
			continue;

		TArray<TopoDS_Edge> CurrentGroup;
		TArray<int32> GroupIndices;
		
		// 使用队列来处理连接,确保找到所有可能的连接
		TArray<int32> ProcessQueue;
		ProcessQueue.Add(i);
		
		while (ProcessQueue.Num() > 0)
		{
			int32 CurrentIndex = ProcessQueue[0];
			ProcessQueue.RemoveAt(0);
			
			if (EdgeProcessed[CurrentIndex])
				continue;
				
			EdgeProcessed[CurrentIndex] = true;
			CurrentGroup.Add(SuitableEdges[CurrentIndex]);
			GroupIndices.Add(CurrentIndex);
			
			// 获取当前边的起点和终点
			FVector StartPoint, EndPoint;
			FGeomUtils::GetEdgeStartAndEnd(SuitableEdges[CurrentIndex], StartPoint, EndPoint, true);

			for (auto& Pair : StartPointToEdgeIndices)
			{
				if (FVector::Distance(Pair.Key, StartPoint) < ConnectionTolerance 
				|| FVector::Distance(Pair.Key, EndPoint) < ConnectionTolerance)
				{
					for (int32 ConnectedIndex : Pair.Value)
					{
						if (!EdgeProcessed[ConnectedIndex])
						{
							ProcessQueue.Add(ConnectedIndex);
						}
					}
				}
			}

			
			// 查找与当前边起点相连的其他边(需要考虑反向连接)
			for (auto& Pair : EndPointToEdgeIndices)
			{
				if (FVector::Distance(Pair.Key, StartPoint) < ConnectionTolerance 
				|| FVector::Distance(Pair.Key, EndPoint) < ConnectionTolerance)
				{
					for (int32 ConnectedIndex : Pair.Value)
					{
						if (!EdgeProcessed[ConnectedIndex])
						{
							ProcessQueue.Add(ConnectedIndex);
						}
					}
				}
			}
		}
		
		// 将找到的连接组排序为首尾相连的形式
		if (CurrentGroup.Num() > 1)
		{
			TArray<TopoDS_Edge> OrderedGroup = SortEdgesWithOCCTWireOrder(CurrentGroup, ConnectionTolerance);
			
			// 如果所有边都已经排序,使用排序后的组替换原始组
			if (OrderedGroup.Num() == CurrentGroup.Num())
			{
				CurrentGroup = OrderedGroup;
			}
		}
		
		// 将当前连接组添加到结果中
		if (CurrentGroup.Num() > 0)
		{
			ConnectedEdgeGroups.Add(CurrentGroup);
		}
	}

	return ConnectedEdgeGroups;
}


void FGeomUtils::ReverseVerticesWithBulge(TArray<FVertexWithBulge>& InOutVertices)
{
	if (InOutVertices.Num() < 2)
		return;

	// 保存原始的bulge值
	TArray<float> OriginalBulges;
	for (const FVertexWithBulge& Vertex : InOutVertices)
	{
		OriginalBulges.Add(Vertex.Bulge);
	}

	// 反转顶点顺序
	Algo::Reverse(InOutVertices);

	// 处理bulge值
	// 1. 每个点的bulge值需要移动到前一个点（在新序列中是下一个点）
	// 2. 所有bulge值需要取反以保持弧的形状
	for (int32 i = 0; i < InOutVertices.Num() - 1; ++i)
	{
		InOutVertices[i].Bulge = -OriginalBulges[InOutVertices.Num() - 2 - i];
	}
	// 最后一个点的bulge值设为0
	InOutVertices.Last().Bulge = 0.0f;
}

TArray<UGeomCurve*> FGeomUtils::SortEdgesWithOCCTWireOrder(const TArray<UGeomCurve*>& InCurves, float Tolerance)
{
	TArray<TopoDS_Edge> Edges;

	for (UGeomCurve* CurveIt : InCurves)
		Edges.Add(TopoDS::Edge(CurveIt->ToShape())); 

	TArray<TopoDS_Edge> OutEdges = SortEdgesWithOCCTWireOrder(Edges, Tolerance);

	TArray<UGeomCurve*> OutCurves;
	for (const TopoDS_Edge& EdgeIt : OutEdges)
	{
		UGeomCurve* Curve = GetGeomCurveFromEdge(EdgeIt);
		OutCurves.Add(Curve);
	}

	return MoveTemp(OutCurves);
}

TArray<TopoDS_Edge> FGeomUtils::SortEdgesWithOCCTWireOrder(const TArray<TopoDS_Edge>& InEdges, float Tolerance)
{
	TArray<TopoDS_Edge> Result;
	if (InEdges.Num() < 2)
		return InEdges;
		
	// 创建ShapeAnalysis_WireOrder对象
	ShapeAnalysis_WireOrder WireOrder(true, Tolerance);
	
	// 使用ShapeAnalysis_Edge来提取边的顶点
	ShapeAnalysis_Edge EdgeAnalyser;
	
	// 打印输入边信息
	//UE_LOG(LogTemp, Log, TEXT("===== 输入边信息 ====="));
	for (int32 i = 0; i < InEdges.Num(); i++)
	{
		TopoDS_Vertex Vf = EdgeAnalyser.FirstVertex(InEdges[i]);
		TopoDS_Vertex Vl = EdgeAnalyser.LastVertex(InEdges[i]);
		
		gp_Pnt Pf = BRep_Tool::Pnt(Vf);
		gp_Pnt Pl = BRep_Tool::Pnt(Vl);
		
		/*UE_LOG(LogTemp, Log, TEXT("输入边 %d: 起点(%f, %f, %f), 终点(%f, %f, %f)"),
			i, Pf.X(), Pf.Y(), Pf.Z(), Pl.X(), Pl.Y(), Pl.Z());*/
	}

	// 添加所有边的端点
	for (const TopoDS_Edge& Edge : InEdges)
	{
		TopoDS_Vertex Vf = EdgeAnalyser.FirstVertex(Edge);
		TopoDS_Vertex Vl = EdgeAnalyser.LastVertex(Edge);
		
		gp_Pnt Pf = BRep_Tool::Pnt(Vf);
		gp_Pnt Pl = BRep_Tool::Pnt(Vl);
		
		WireOrder.Add(Pf.XYZ(), Pl.XYZ());
	}
	
	//UE_LOG(LogTemp, Log, TEXT("===== 执行ShapeAnalysis_WireOrder排序 ====="));
	WireOrder.Perform();
	if(WireOrder.IsDone())
	{
		//UE_LOG(LogTemp, Log, TEXT("OCCT WireOrder Status: %d"), WireOrder.Status());
		
		// 打印原始顺序和排序后顺序的对应关系
		//UE_LOG(LogTemp, Log, TEXT("===== ShapeAnalysis_WireOrder排序结果 ====="));
		for (int32 i = 1; i <= InEdges.Num(); i++)
		{
			int32 IndexInArray = WireOrder.Ordered(i);
			//UE_LOG(LogTemp, Log, TEXT("排序位置 %d -> 原始边索引 %d (正/负表示是否需要反转)"), i, IndexInArray);
			FVector Start, End;
			FGeomUtils::GetEdgeStartAndEnd(InEdges[FMath::Abs(IndexInArray)-1], Start, End, true);
			/*UE_LOG(LogTemp, Log, TEXT("排序前边 %d: StartPoint: %s, EndPoint: %s"),
			i, *Start.ToString(), *End.ToString());*/
		}
	}
	else
	{
		//UE_LOG(LogTemp, Warning, TEXT("OCCT WireOrder Failed!"));
		return InEdges;
	}
	
	// 根据排序结果添加边
	for (int32 i = 1; i <= InEdges.Num(); i++)
	{
		int32 IndexInArray = WireOrder.Ordered(i);

		// 注意：ShapeAnalysis_WireOrder返回的索引是从1开始的
		// 如果返回的索引为负数，表示需要反转边的方向
		int32 AbsIdx = FMath::Abs(IndexInArray) - 1;

		if (AbsIdx >= 0 && AbsIdx < InEdges.Num())
		{
			if (IndexInArray > 0)
			{
				Result.Add(InEdges[AbsIdx]);
			}
			else
			{
				// 复制并反转边
				Result.Add(TopoDS::Edge(InEdges[AbsIdx].Reversed()));
			}
		}
	}
	
	// 如果不是起点开始，则需要反转
	bool bIsConnectedFromStart = IsConnectedFromStart(Result);
	//UE_LOG(LogTemp, Log, TEXT("检查边是否从起点开始连接: %s"), bIsConnectedFromStart ? TEXT("是") : TEXT("否"));
	if(!bIsConnectedFromStart)
	{
		//UE_LOG(LogTemp, Log, TEXT("不是从起点开始连接，需要反转整个数组"));
		Algo::Reverse(Result);
	}

	// 打印排序后的边信息
	//UE_LOG(LogTemp, Log, TEXT("===== 最终排序结果 ====="));
	for (int32 i = 0; i < Result.Num(); i++)
	{
		FVector StartPoint, EndPoint;
		GetEdgeStartAndEnd(Result[i], StartPoint, EndPoint, true);
		/*UE_LOG(LogTemp, Log, TEXT("排序后边 %d: StartPoint: %s, EndPoint: %s"),
			i, *StartPoint.ToString(), *EndPoint.ToString());*/
	}
	
	return Result;
}

// 一组连续的边是否从起点开始连接
bool FGeomUtils::IsConnectedFromStart(const TArray<TopoDS_Edge>& Edges)
{
    if (Edges.Num() == 0)
    {
        return true;
    }
    // 获取第一条边的起点
    bool bIsStart = true;
    FVertexWithBulge FirstStart, FirstEnd;
    FGeomUtils::GetVertexWithBulgesFromEdge(Edges[0], FirstStart, FirstEnd, true);
    if (Edges.Num() > 1)
    {
        FVertexWithBulge SecondStart, SecondEnd;
        FGeomUtils::GetVertexWithBulgesFromEdge(Edges[1], SecondStart, SecondEnd, true);
        if(FVector::Distance(FirstEnd.Position, SecondStart.Position) > 0.001f)
		{
			return false;
		}
    }
    return true;
}

TArray<FVector> FGeomUtils::GetShapeOutlinePoints(const TopoDS_Shape& InShape)
{
	TArray<FVertexWithBulge> Outline;
	TArray<TArray<FVertexWithBulge>> Holes;

	GetFaceOutlineAndHoles(InShape, Outline, Holes);

	TArray<FVector> OutPoints = DiscreteVerticesWithBulge(Outline);

	return MoveTemp(OutPoints);
}

// 可以根据需要，继续添加其它方式，最终目的就是合成一个区域
bool FGeomUtils::MergeConnectedPolygons(const TArray<FVector>& Polygon1, const TArray<FVector>& Polygon2, TArray<FVector>& OutPolys, bool SkipCleanPolygons)
{
	if (Polygon1.Num() < 3 || Polygon2.Num() < 3)
		return false;

	// 尝试多种缩放
	TArray<float> ScaleValues = { 100.f, 10.f, 1000.f };

	for (const float Scale : ScaleValues)
	{
		Clipper C;
		Paths Path1;
		Paths Path2;
		Paths PathSolution;

		Path1.resize(1);
		for (int i = 0; i < Polygon1.Num(); i++)
		{
			cInt x = FMath::RoundToInt(Polygon1[i].X * Scale);
			cInt y = FMath::RoundToInt(Polygon1[i].Y * Scale);
			Path1[0].push_back(IntPoint(x, y));
		}

		Path2.resize(1);
		for (int i = 0; i < Polygon2.Num(); i++)
		{
			cInt x = FMath::RoundToInt(Polygon2[i].X * Scale);
			cInt y = FMath::RoundToInt(Polygon2[i].Y * Scale);
			Path2[0].push_back(IntPoint(x, y));
		}

		C.AddPaths(Path1, ptSubject, true);
		C.AddPaths(Path2, ptClip, true);
		C.Execute(ctUnion, PathSolution, pftEvenOdd, pftEvenOdd);

		if (PathSolution.size() == 1)
		{
			OutPolys.Empty();
			for (const IntPoint& Point : PathSolution[0])
				OutPolys.Emplace(Point.X / Scale, Point.Y / Scale, 0.0f);

			// 清理掉误差等杂数据
		//	if (!SkipCleanPolygons)
		//		FBKMath::CleanPolygon(OutPolys, 0.5);	// 误差太小的话，有些过滤不掉...

			return true;
		}
	}

	return false;
}

float FGeomUtils::VectorSign(const FVector2D& Vec, const FVector2D& A, const FVector2D& B)
{
	return FMath::Sign((B.X - A.X) * (Vec.Y - A.Y) - (B.Y - A.Y) * (Vec.X - A.X));
}

// Returns true when the point is inside the triangle
// Should not return true when the point is on one of the edges
bool FGeomUtils::IsPointInTriangle(const FVector2D& TestPoint, const FVector2D& A, const FVector2D& B, const FVector2D& C)
{
	float BA = VectorSign(B, A, TestPoint);
	float CB = VectorSign(C, B, TestPoint);
	float AC = VectorSign(A, C, TestPoint);

	// point is in the same direction of all 3 tri edge lines
	// must be inside, regardless of tri winding
	return BA == CB && CB == AC;
}

bool FGeomUtils::IsPointInOrOnTriangle(const FVector2D& TestPoint, const FVector2D& A, const FVector2D& B, const FVector2D& C)
{
	const FVector2D& P = TestPoint;
	// 计算边向量和点到顶点的向量
	const FVector2D AB = B - A;
	const FVector2D BC = C - B;
	const FVector2D CA = A - C;

	// 三次叉乘检测（允许等于0）
	float crossAB = FVector2D::CrossProduct(AB, P - A);
	float crossBC = FVector2D::CrossProduct(BC, P - B);
	float crossCA = FVector2D::CrossProduct(CA, P - C);

	// 检测点是否在所有边的同一侧或边上
	bool allNonNegative = (crossAB >= 0) && (crossBC >= 0) && (crossCA >= 0);
	bool allNonPositive = (crossAB <= 0) && (crossBC <= 0) && (crossCA <= 0);
	if (!(allNonNegative || allNonPositive)) return false;

	// 安全距离检测（允许点位于边上时接近顶点）
	const FVector2D AP = P - A, BP = P - B, CP = P - C;
	const float MinDistanceSq = 2.0f;
	if (AP.SizeSquared() < MinDistanceSq && FMath::Abs(crossAB) > KINDA_SMALL_NUMBER) return false;
	if (BP.SizeSquared() < MinDistanceSq && FMath::Abs(crossBC) > KINDA_SMALL_NUMBER) return false;
	if (CP.SizeSquared() < MinDistanceSq && FMath::Abs(crossCA) > KINDA_SMALL_NUMBER) return false;
	return true;
}

// Returns true when the point is on the line segment limited by A and B
bool FGeomUtils::IsPointOnLineSegment(const FVector2D& TestPoint, const FVector2D& A, const FVector2D& B)
{
	FVector2D BA = B - A;
	FVector2D PA = TestPoint - A;
	float SizeSquaredBA = FVector2D::DotProduct(BA, BA);
	float AreaCompareThreshold = 0.01f * SizeSquaredBA;
	float ParallelogramArea = BA.X * PA.Y - BA.Y * PA.X;

	return  TestPoint.X >= FMath::Min(A.X, B.X) && TestPoint.X <= FMath::Max(A.X, B.X) && // X within AB.X, including ON A or B
		TestPoint.Y >= FMath::Min(A.Y, B.Y) && TestPoint.Y <= FMath::Max(A.Y, B.Y) && // Y within AB.Y, including ON A or B
		FMath::Abs(ParallelogramArea) < AreaCompareThreshold; // Area is smaller than allowed epsilon = point on line
}

bool FGeomUtils::IsFaceInsideOrOnShape(const TopoDS_Face& InFace, const TopoDS_Shape& InShape, float Tolerance /*= FPrecision::Approximation()*/)
{
    // 检查输入形状的有效性
    if (InFace.IsNull() || InShape.IsNull())
    {
        // UE_LOG(LogTemp, Warning, TEXT("IsFaceInsideOrOnShape: Input shape is null."));
        return false;
    }

    BRepCheck_Analyzer aChecker(InFace);
    if (!aChecker.IsValid(InFace))
    {
        // UE_LOG(LogTemp, Warning, TEXT("IsFaceInsideOrOnShape: Input face is invalid."));
        return false;
    }

    aChecker.Init(InShape);
     if (!aChecker.IsValid(InShape))
    {
        // UE_LOG(LogTemp, Warning, TEXT("IsFaceInsideOrOnShape: Input shape is invalid."));
        return false;
    }

    // 计算面与形状的交集
    BRepAlgoAPI_Common Common(InFace, InShape);
    Common.SetFuzzyValue(Tolerance); // 设置容差
    Common.Build();

    if (!Common.IsDone())
    {
        // UE_LOG(LogTemp, Warning, TEXT("IsFaceInsideOrOnShape: BRepAlgoAPI_Common failed."));
        return false;
    }

    TopoDS_Shape ResultShape = Common.Shape();

    // *** 更可靠的判断逻辑 ***
    // 1. 检查交集结果是否为空或不包含任何面
    TopExp_Explorer faceExplorer(ResultShape, TopAbs_FACE);
    if (!faceExplorer.More())
    {
        // 交集结果不包含任何面，说明没有交集
        return false;
    }

    // 2. 检查交集结果是否与原始面片近似相等
    //    遍历交集结果中的所有面，看是否能找到一个与原始面片几何上近似相等的面
    //    这里需要考虑原始面片与体交集后，可能被分割成多个面
    //    一个简单但可能不够完美的检查是：原始面片的所有顶点是否都在交集结果的面上
    //    或者更直接的：比较交集结果形状和原始面片的面积（如果可以计算）或边界线框

    // 尝试使用 AreShapesApproximatelyEqual，尽管对体积为零的形状不完美
    // 结合前面的空形状检查，可以在一定程度上提高准确性
    bool bIsApproximatelyEqual = AreShapesApproximatelyEqual(InFace, ResultShape, Tolerance);

    // *** 更严谨的检查（可选）：遍历交集结果中的面，与InFace进行几何比较 ***
    // For a more robust check, you might iterate through faces in ResultShape
    // and compare them geometrically to InFace, e.g., compare surfaces and boundaries.
    // This would require more complex OCCT calls (like BRepLib::IsEqual or comparing wire structures).
    // For now, let's rely on the improved check above.

    return bIsApproximatelyEqual;
}

bool FGeomUtils::AreFacesConnected(const TopoDS_Face& InFace1, const TopoDS_Face& InFace2, double Tolerance)
{
    // 获取两个面的边
    TArray<TopoDS_Edge> Edges1, Edges2;
    GetShapeEdges(InFace1, Edges1);
    GetShapeEdges(InFace2, Edges2);

    // 检查是否有共同的边
    for (const TopoDS_Edge& Edge1 : Edges1)
    {
        for (const TopoDS_Edge& Edge2 : Edges2)
        {
            if (ComputeDistance(Edge1, Edge2) < Tolerance)
            {
                return true;
            }
        }
    }

    // 如果没有共同的边，检查是否有共同的顶点
    TArray<TopoDS_Vertex> Vertices1, Vertices2;
    GetShapeVertexes(InFace1, Vertices1);
    GetShapeVertexes(InFace2, Vertices2);

    for (const TopoDS_Vertex& Vertex1 : Vertices1)
    {
        for (const TopoDS_Vertex& Vertex2 : Vertices2)
        {
            if (ComputeDistance(Vertex1, Vertex2) < Tolerance)
            {
                return true;
            }
        }
    }

    return false;
}

bool FGeomUtils::AreFacesConnectedTopology(const TopoDS_Face &InFace1, const TopoDS_Face &InFace2)
{
	for (TopExp_Explorer ExpA(InFace1, TopAbs_EDGE); ExpA.More(); ExpA.Next())
	{
		const TopoDS_Edge& EdgeA = TopoDS::Edge(ExpA.Current());
		for (TopExp_Explorer ExpB(InFace2, TopAbs_EDGE); ExpB.More(); ExpB.Next())
		{
			const TopoDS_Edge& EdgeB = TopoDS::Edge(ExpB.Current());
			if (EdgeA.IsSame(EdgeB))
			{
				return true;
			}
		}
	}
	return false;
}

int32 FGeomUtils::GetFaceIndex(const TopoDS_Shape &InFace, const TopoDS_Shape &InShape)
{
    if (InFace.IsNull() || InShape.IsNull() || InFace.ShapeType() != TopAbs_FACE)
        return -1;

    const TopoDS_Face& CurFace = TopoDS::Face(InFace);
    TopTools_IndexedMapOfShape FaceMap;
    TopExp::MapShapes(InShape, TopAbs_FACE, FaceMap);
    
    for (int i = 1; i <= FaceMap.Extent(); i++)
    {
        if (CurFace.IsSame(TopoDS::Face(FaceMap(i))))
        {
            return i;
        }
    }

    return -1;
}

int32 FGeomUtils::GetEdgeIndex(const TopoDS_Shape& InEdge, const TopoDS_Shape& InShape)
{
    if (InEdge.IsNull() || InShape.IsNull() || InEdge.ShapeType() != TopAbs_EDGE)
        return -1;

    const TopoDS_Edge& CurEdge = TopoDS::Edge(InEdge);
    TopTools_IndexedMapOfShape EdgeMap;
    TopExp::MapShapes(InShape, TopAbs_EDGE, EdgeMap);
    
    for (int i = 1; i <= EdgeMap.Extent(); i++)
    {
        if (CurEdge.IsSame(TopoDS::Edge(EdgeMap(i))))
        {
            return i;
        }
    }

    return -1;
}

TArray<int32> FGeomUtils::GetFaceIndexByEdge(const TopoDS_Shape& InEdge, const TopoDS_Shape& InShape)
{
	TArray<int32> FaceIndices;
    if (InEdge.IsNull() || InShape.IsNull() || InEdge.ShapeType() != TopAbs_EDGE)
        return FaceIndices;
    const TopoDS_Edge& CurEdge = TopoDS::Edge(InEdge);
    TopTools_IndexedMapOfShape FaceMap;
    TopExp::MapShapes(InShape, TopAbs_FACE, FaceMap);
    
    for (int32 i = 1; i <= FaceMap.Extent(); ++i)
    {
		TopoDS_Face TempFace = TopoDS::Face(FaceMap(i));
	    TopTools_IndexedMapOfShape EdgeMap;
	    TopExp::MapShapes(TempFace, TopAbs_EDGE, EdgeMap);
		for (int32 j = 1; j <= EdgeMap.Extent(); ++j)
		{
			if (CurEdge.IsSame(TopoDS::Edge(EdgeMap(j))))
			{
				FaceIndices.Add(i);
			}
		}

    }

    return FaceIndices;
}

bool FGeomUtils::FindFaceByIndex(const TopoDS_Shape& InShape, int32 Index, TopoDS_Face& OutFace)
{
    if (InShape.IsNull())
        return false;

    TopTools_IndexedMapOfShape FaceMap;
    TopExp::MapShapes(InShape, TopAbs_FACE, FaceMap);    

    if (Index < 1 || Index > FaceMap.Extent())
    {
        return false;
    }

    OutFace = TopoDS::Face(FaceMap(Index));
    return true;
}

bool FGeomUtils::FindEdgeByIndex(const TopoDS_Shape& InShape, int32 Index, TopoDS_Edge& OutEdge)
{
    if (InShape.IsNull())
        return false;

    TopTools_IndexedMapOfShape EdgeMap;
    TopExp::MapShapes(InShape, TopAbs_EDGE, EdgeMap);        

    if (Index < 1 || Index > EdgeMap.Extent())
    {
        return false;
    }

    OutEdge = TopoDS::Edge(EdgeMap(Index));
    return true;
}

double FGeomUtils::CalculateShapeArea(const TopoDS_Shape& InShape) 
{
	GProp_GProps props;
	double totalArea = 0.0;
	for (TopExp_Explorer faceExp(InShape, TopAbs_FACE); faceExp.More(); faceExp.Next()) 
	{
		TopoDS_Face face = TopoDS::Face(faceExp.Current());
		BRepGProp::SurfaceProperties(face, props);
		totalArea += props.Mass(); 
	}
	return totalArea;
}

double FGeomUtils::CalculateShapePerimeter(const TopoDS_Shape& InShape) {
	GProp_GProps props;
	double totalPerimeter = 0.0;
	for (TopExp_Explorer edgeExp(InShape, TopAbs_EDGE); edgeExp.More(); edgeExp.Next()) 
	{
		TopoDS_Edge edge = TopoDS::Edge(edgeExp.Current());
		BRepGProp::LinearProperties(edge, props);
		totalPerimeter += props.Mass();
	}
	return totalPerimeter;
}

TopoDS_Shape FGeomUtils::GetMaxAreaShape(const TopoDS_Shape& InShape)
{	
	double MaxArea = -1;
	TopoDS_Shape OutShape = InShape;

	GProp_GProps props;
	for (TopExp_Explorer faceExp(InShape, TopAbs_FACE); faceExp.More(); faceExp.Next())
	{
		TopoDS_Face face = TopoDS::Face(faceExp.Current());

		double Area = CalculateShapeArea(face);
		if (Area > MaxArea)
		{
			MaxArea = Area;
			OutShape = face;
		}
	}
	return OutShape;
}

// By AI
double FGeomUtils::CalculateOverlapArea(const TopoDS_Shape& shape1, const TopoDS_Shape& shape2)
{
	// 计算两个形状的布尔交集
	BRepAlgoAPI_Common commonOp(shape1, shape2);
	commonOp.Build();

	if (!commonOp.IsDone()) 		
		return 0.0;

	// 获取交集结果
	TopoDS_Shape commonShape = commonOp.Shape();

	// 计算交集的面积
	GProp_GProps props;
	BRepGProp::SurfaceProperties(commonShape, props);

	return props.Mass(); // 在这里，Mass()实际返回的是面积
}

void FGeomUtils::RemoveRepeatedLines(TArray<UGeomCurve*>& Curves, double Tolerance)
{
	for (int i = 0; i < Curves.Num(); ++i)
	{		
		if (!Curves[i])
			continue;

		for (int j = Curves.Num() - 1; j > i; --j)
		{
			if (!Curves[j])
				continue;

			if (Curves[i]->IsA<UGeomTrimmedCurve>() && Curves[j]->IsA<UGeomTrimmedCurve>())
			{
				UGeomTrimmedCurve* Curve1 = Cast<UGeomTrimmedCurve>(Curves[i]);
				UGeomTrimmedCurve* Curve2 = Cast<UGeomTrimmedCurve>(Curves[j]);

				// 同向或反向 bulge 均可视为匹配
				double BulgeDiff = FMath::Abs(Curve1->GetBulge() - Curve2->GetBulge());
				double BulgeOpp  = FMath::Abs(Curve1->GetBulge() + Curve2->GetBulge());
				bool bBulgeMatch = (BulgeDiff <= Tolerance) || (BulgeOpp <= Tolerance);

				if (bBulgeMatch)
				{
					bool bSameForward = Curve1->GetStartPoint().Equals(Curve2->GetStartPoint(), Tolerance) &&
					                    Curve1->GetEndPoint().Equals  (Curve2->GetEndPoint(),   Tolerance);
					bool bSameReverse = Curve1->GetStartPoint().Equals(Curve2->GetEndPoint(),   Tolerance) &&
					                    Curve1->GetEndPoint().Equals  (Curve2->GetStartPoint(), Tolerance);
					if (!(Curve1->IsA<UGeomArcOfCircle>() && Curve2->IsA<UGeomArcOfCircle>()))
					{
						if (bSameForward || bSameReverse)
						{
							Curves.RemoveAt(j);
						}
					}
					else
					{
						if ((bSameForward && BulgeDiff <= Tolerance) || (bSameReverse && BulgeOpp <= Tolerance))
						{
							Curves.RemoveAt(j);
						}
					}
				}
			}
			
		}
	}
}

bool FGeomUtils::GetCurveStartAndEndPoint(const UGeomCurve* InCurve, FVector& OutStartPoint, FVector& OutEndPoint)
{
	if (!InCurve)
		return false;

	Handle(Geom_Curve) TempCurve = Handle(Geom_Curve)::DownCast(InCurve->GetHandle());
	if (!TempCurve)
		return false;

	gp_Pnt StartPoint;
	Standard_Real StartParam = TempCurve->FirstParameter();
	TempCurve->D0(StartParam, StartPoint);

	gp_Pnt EndPoint;
	Standard_Real EndParam = TempCurve->LastParameter();
	TempCurve->D0(EndParam, EndPoint);

	OutStartPoint = FVector(StartPoint.X(), StartPoint.Y(), StartPoint.Z());
	OutEndPoint = FVector(EndPoint.X(), EndPoint.Y(), EndPoint.Z());

	return true;
}

bool FGeomUtils::IsValidTriangle(const TArray<UGeomCurve*>& Curves)
{
	TMap<FVector, int> Data;

	if (Curves.Num() != 3)
		return false;

	for (int i = 0; i < Curves.Num(); ++i)
	{
		FVector Start, End;
		if (!GetCurveStartAndEndPoint(Curves[i], Start, End))
			return false;

		bool bAddedStart = false, bAddedEnd = false;
		for (auto& It : Data)
		{
			if (It.Key.Equals(Start, FPrecision::Confusion()))
			{
				++It.Value;
				bAddedStart = true;
			}

			if (It.Key.Equals(End, FPrecision::Confusion()))
			{
				++It.Value;
				bAddedEnd = true;
			}
		}

		if (!bAddedStart)
			Data.Add(Start, 1);

		if (!bAddedEnd)
			Data.Add(End, 1);
	}

	if (Data.Num() != 3)
		return false;

	for (auto It : Data)
	{
		if (It.Value != 2)
			return false;
	}

	return true;
}


bool FGeomUtils::SplitShape(const TopoDS_Shape& InShape, const TArray<UGeomCurve*>& InCurves, TArray<TopoDS_Shape>& OutShapes)
{
	if (InCurves.Num() == 0)
		return false;

	TArray<TopoDS_Edge> ExtractedFaceEdges;
	FGeomUtils::GetShapeEdges(InShape, ExtractedFaceEdges);
	TArray<UGeomCurve*> ShapeCurves = FGeomUtils::GetGeomCurveListFromEdges(ExtractedFaceEdges);

	// 打断
	TArray<UGeomCurve*> SplitLines = InCurves;
	SplitLinesIfIntersect(ShapeCurves, SplitLines);

	TArray<UGeomCurve*> AllCurves;
	AllCurves.Append(ShapeCurves);
	AllCurves.Append(SplitLines);

	TArray<TopoDS_Shape> ClosedShapeList;
	TArray<TArray<UGeomCurve*>> ClosedCurveList = GetClosedCurvesListFromUnorderCurves(AllCurves);	
	for (int i = 0; i < ClosedCurveList.Num(); ++i)
	{
		TArray<UGeometryBase*> SortCurves;
		SortCurves.Append(ClosedCurveList[i]);
		SortCurves = FGeomUtils::BuildConnectedGeometryGroups(SortCurves);

		TArray<UGeomCurve*> TempCurve;
		for (UGeometryBase* It : SortCurves)
		{
			TempCurve.Add(Cast<UGeomCurve>(It));
		}

		TopoDS_Shape CurShape;
		FGeomUtils::CreateClosedShapeFromCurves(TempCurve, CurShape);
		ClosedShapeList.Add(CurShape);
	}

	TopoDS_Shape CurShape = BooleanOperationTools::BuildShapeFromBooleanOperation(BooleanOperationType::BOP_Common, { InShape }, ClosedShapeList);
	TArray<TopoDS_Face> AllFaces;
	FGeomUtils::GetShapeFaces(CurShape, AllFaces);

	if (AllFaces.Num() == 1)
	{
		if (AreShapesApproximatelyEqual(AllFaces[0], InShape))
			return false;
	}
	else if (AllFaces.Num() > 1)
	{
		OutShapes.Append(AllFaces);
		return true;
	}

	return false;
}

// ============================================================================
// 🆕 表面编辑相关的通用几何算法实现
// ============================================================================

bool FGeomUtils::FindCurvesIntersections(
	const TArray<UGeomCurve*>& InCurves, 
	TArray<FCurveIntersectionInfo>& OutIntersections, 
	double Tolerance)
{
	UE_LOG(LogTemp, Log, TEXT("FGeomUtils::FindCurvesIntersections - 开始查找 %d 条曲线的交点"), InCurves.Num());
	
	OutIntersections.Empty();
	
	if (InCurves.Num() < 2)
	{
		UE_LOG(LogTemp, Warning, TEXT("FGeomUtils::FindCurvesIntersections - 曲线数量不足2条，无法计算交点"));
		return false;
	}
	
	int32 IntersectionCount = 0;
	
	// 遍历所有曲线对，查找交点
	for (int32 i = 0; i < InCurves.Num(); ++i)
	{
		for (int32 j = i + 1; j < InCurves.Num(); ++j)
		{
			UGeomCurve* Curve1 = InCurves[i];
			UGeomCurve* Curve2 = InCurves[j];
			
			if (!Curve1 || !Curve2)
			{
				continue;
			}
			// 使用现有的AreEdgesIntersecting方法检查是否相交
			TopoDS_Shape Shape1 = Curve1->ToShape();
			TopoDS_Shape Shape2 = Curve2->ToShape();

			if (Shape1.ShapeType() != TopAbs_EDGE || Shape2.ShapeType() != TopAbs_EDGE)
			{
				continue;
			}
			// 使用IntTools_EdgeEdge进行精确的边-边交点计算
			TopoDS_Edge Edge1 = TopoDS::Edge(Shape1);
			TopoDS_Edge Edge2 = TopoDS::Edge(Shape2);
			
			// 使用 IntTools_EdgeEdge 进行真正的边交计算
			IntTools_EdgeEdge Intersector;
			Intersector.SetEdge1(Edge1);
			Intersector.SetEdge2(Edge2);
			Intersector.SetFuzzyValue(Tolerance);
			
			Intersector.Perform();
			
			bool bFoundIntersection = false;
			
			if (Intersector.IsDone())
			{
				const IntTools_SequenceOfCommonPrts& CommonParts = Intersector.CommonParts();

				
				UE_LOG(LogTemp, VeryVerbose, TEXT("IntTools_EdgeEdge找到 %d 个公共部分，曲线 %d 和 %d"), 
					CommonParts.Length(), i, j);


				
				for (int32 k = 1; k <= CommonParts.Length(); ++k)
				{
					const IntTools_CommonPrt& CommonPart = CommonParts(k);
					
					if (CommonPart.Type() == TopAbs_VERTEX)
					{
						// 获取交点位置
						gp_Pnt Point1, Point2;
						CommonPart.BoundingPoints(Point1, Point2);
						gp_Pnt Point = Point1; // 对于顶点类型，两个点应该是相同的
						
						// 获取参数值
						double Param1 = CommonPart.VertexParameter1();
						double Param2 = CommonPart.VertexParameter2();
						
						// 创建交点信息
						FCurveIntersectionInfo IntersectionInfo;
						IntersectionInfo.Position = FVector(Point.X(), Point.Y(), Point.Z());
						IntersectionInfo.Curve1Index = i;
						IntersectionInfo.Curve2Index = j;
						IntersectionInfo.Parameter1 = Param1;
						IntersectionInfo.Parameter2 = Param2;
						IntersectionInfo.Tolerance = Tolerance;
						
						OutIntersections.Add(IntersectionInfo);
						IntersectionCount++;
						bFoundIntersection = true;
						
						UE_LOG(LogTemp, VeryVerbose, TEXT("发现交点 %d: 位置(%f,%f,%f), 参数1=%f, 参数2=%f, 曲线 %d 和 %d"), 
							IntersectionCount, Point.X(), Point.Y(), Point.Z(), Param1, Param2, i, j);
					}
					else if (CommonPart.Type() == TopAbs_EDGE)
					{
						// 使用统一的边重叠算法处理重叠情况
						TArray<FCurveIntersectionInfo> OverlapIntersections;
						if (ProcessEdgeOverlap(Edge1, Edge2, CommonPart, i, j, Tolerance, OverlapIntersections))
						{
							// 添加所有重叠交点
							for (const FCurveIntersectionInfo& OverlapInfo : OverlapIntersections)
							{
								OutIntersections.Add(OverlapInfo);
								IntersectionCount++;
								bFoundIntersection = true;
								
								UE_LOG(LogTemp, VeryVerbose, TEXT("发现重叠边交点 %d: 位置(%f,%f,%f), 参数1=%f, 参数2=%f, 曲线 %d 和 %d"), 
									IntersectionCount, OverlapInfo.Position.X, OverlapInfo.Position.Y, OverlapInfo.Position.Z,
									OverlapInfo.Parameter1, OverlapInfo.Parameter2, i, j);
							}
						}
					}
				}
			}
			
			// 如果IntTools_EdgeEdge没有找到交点，或者计算失败，则使用端点检测补充算法
			if (!bFoundIntersection)
			{
				UE_LOG(LogTemp, VeryVerbose, TEXT("IntTools_EdgeEdge未发现交点，尝试端点检测补充算法，曲线 %d 和 %d"), i, j);
				
				TArray<FCurveIntersectionInfo> EndpointIntersections;
				if (CheckEndpointOnSegmentIntersection(Edge1, Edge2, i, j, Tolerance, EndpointIntersections))
				{
					// 添加端点检测发现的交点
					for (const FCurveIntersectionInfo& EndpointInfo : EndpointIntersections)
					{
						OutIntersections.Add(EndpointInfo);
						IntersectionCount++;
						
						UE_LOG(LogTemp, VeryVerbose, TEXT("端点检测发现交点 %d: 位置(%f,%f,%f), 参数1=%f, 参数2=%f, 曲线 %d 和 %d"), 
							IntersectionCount, EndpointInfo.Position.X, EndpointInfo.Position.Y, EndpointInfo.Position.Z,
							EndpointInfo.Parameter1, EndpointInfo.Parameter2, i, j);
					}
				}
			}
		}
	}
	
	
	UE_LOG(LogTemp, Log, TEXT("FGeomUtils::FindCurvesIntersections - 完成，找到 %d 个交点"), IntersectionCount);
	return IntersectionCount > 0;
}

bool FGeomUtils::ProcessEdgeOverlap(
	const TopoDS_Edge& Edge1,
	const TopoDS_Edge& Edge2,
	const IntTools_CommonPrt& CommonPart,
	int32 Curve1Index,
	int32 Curve2Index,
	double Tolerance,
	TArray<FCurveIntersectionInfo>& OutIntersections)
{
	UE_LOG(LogTemp, VeryVerbose, TEXT("ProcessEdgeOverlap - 处理边重叠情况，曲线 %d 和 %d"), Curve1Index, Curve2Index);
	
	OutIntersections.Empty();
	
	// 获取重叠部分的边界点
	gp_Pnt Point1, Point2;
	CommonPart.BoundingPoints(Point1, Point2);
	
	// 获取两条边的参数范围
	double Edge1FirstParam, Edge1LastParam;
	double Edge2FirstParam, Edge2LastParam;
	
	Handle(Geom_Curve) Curve1 = BRep_Tool::Curve(Edge1, Edge1FirstParam, Edge1LastParam);
	Handle(Geom_Curve) Curve2 = BRep_Tool::Curve(Edge2, Edge2FirstParam, Edge2LastParam);
	
	if (Curve1.IsNull() || Curve2.IsNull())
	{
		UE_LOG(LogTemp, Warning, TEXT("ProcessEdgeOverlap - 无法获取边的几何曲线"));
		return false;
	}
	
	// 获取重叠段在两条边上的参数范围
	double Overlap1Start, Overlap1End;
	CommonPart.Range1(Overlap1Start, Overlap1End);
	
	// 获取第二条边的范围序列（可能有多个范围）
	const IntTools_SequenceOfRanges& Ranges2 = CommonPart.Ranges2();
	if (Ranges2.Length() < 1)
	{
		UE_LOG(LogTemp, Warning, TEXT("ProcessEdgeOverlap - 第二条边没有有效的参数范围"));
		return false;
	}
	
	// 使用第一个范围（通常边重叠只有一个范围）
	const IntTools_Range& Range2 = Ranges2(1);
	double Overlap2Start = Range2.First();
	double Overlap2End = Range2.Last();
	
	// 将重叠段的两个端点作为交点
	// 端点1
	gp_Pnt OverlapStart = Curve1->Value(Overlap1Start);
	FCurveIntersectionInfo StartInfo;
	StartInfo.Position = FVector(OverlapStart.X(), OverlapStart.Y(), OverlapStart.Z());
	StartInfo.Curve1Index = Curve1Index;
	StartInfo.Curve2Index = Curve2Index;
	StartInfo.Parameter1 = Overlap1Start;
	StartInfo.Parameter2 = Overlap2Start;
	StartInfo.Tolerance = Tolerance;
	
	// 端点2
	gp_Pnt OverlapEnd = Curve1->Value(Overlap1End);
	FCurveIntersectionInfo EndInfo;
	EndInfo.Position = FVector(OverlapEnd.X(), OverlapEnd.Y(), OverlapEnd.Z());
	EndInfo.Curve1Index = Curve1Index;
	EndInfo.Curve2Index = Curve2Index;
	EndInfo.Parameter1 = Overlap1End;
	EndInfo.Parameter2 = Overlap2End;
	EndInfo.Tolerance = Tolerance;
	
	// 检查两个端点是否实际上是不同的点（避免重复点）
	double DistanceSquared = FVector::DistSquared(EndInfo.Position, StartInfo.Position);
	if (DistanceSquared > Tolerance * Tolerance)
	{
		// 两个端点不同，添加两个交点
		OutIntersections.Add(StartInfo);
		OutIntersections.Add(EndInfo);
		
		UE_LOG(LogTemp, VeryVerbose, TEXT("ProcessEdgeOverlap - 添加重叠段两个端点作为交点"));
		UE_LOG(LogTemp, VeryVerbose, TEXT("  起点: (%f,%f,%f), 参数1=%f, 参数2=%f"), 
			StartInfo.Position.X, StartInfo.Position.Y, StartInfo.Position.Z,
			StartInfo.Parameter1, StartInfo.Parameter2);
		UE_LOG(LogTemp, VeryVerbose, TEXT("  终点: (%f,%f,%f), 参数1=%f, 参数2=%f"), 
			EndInfo.Position.X, EndInfo.Position.Y, EndInfo.Position.Z,
			EndInfo.Parameter1, EndInfo.Parameter2);
	}
	else
	{
		// 两个端点太接近，只添加一个交点
		OutIntersections.Add(StartInfo);
		
		UE_LOG(LogTemp, VeryVerbose, TEXT("ProcessEdgeOverlap - 重叠段退化为单点，添加一个交点"));
		UE_LOG(LogTemp, VeryVerbose, TEXT("  交点: (%f,%f,%f), 参数1=%f, 参数2=%f"), 
			StartInfo.Position.X, StartInfo.Position.Y, StartInfo.Position.Z,
			StartInfo.Parameter1, StartInfo.Parameter2);
	}
	
	return OutIntersections.Num() > 0;
}

bool FGeomUtils::CheckEndpointOnSegmentIntersection(
	const TopoDS_Edge& Edge1,
	const TopoDS_Edge& Edge2,
	int32 Curve1Index,
	int32 Curve2Index,
	double Tolerance,
	TArray<FCurveIntersectionInfo>& OutIntersections)
{
	UE_LOG(LogTemp, VeryVerbose, TEXT("CheckEndpointOnSegmentIntersection - 检测端点相交，曲线 %d 和 %d"), Curve1Index, Curve2Index);
	
	OutIntersections.Empty();
	
	// 获取两条边的几何曲线和参数范围
	double Edge1FirstParam, Edge1LastParam;
	double Edge2FirstParam, Edge2LastParam;
	
	Handle(Geom_Curve) Curve1 = BRep_Tool::Curve(Edge1, Edge1FirstParam, Edge1LastParam);
	Handle(Geom_Curve) Curve2 = BRep_Tool::Curve(Edge2, Edge2FirstParam, Edge2LastParam);
	
	if (Curve1.IsNull() || Curve2.IsNull())
	{
		UE_LOG(LogTemp, VeryVerbose, TEXT("CheckEndpointOnSegmentIntersection - 无法获取边的几何曲线"));
		return false;
	}
	
	// Lambda表达式：检测一个点是否在指定曲线上，并创建交点信息
	auto CheckPointOnCurve = [&](const gp_Pnt& TestPoint, 
								  double TestPointParam,
								  const Handle(Geom_Curve)& TargetCurve, 
								  double TargetFirstParam, 
								  double TargetLastParam,
								  int32 TestCurveIndex,
								  int32 TargetCurveIndex,
								  const FString& LogDescription) -> bool
	{
		GeomAPI_ProjectPointOnCurve Projector(TestPoint, TargetCurve, TargetFirstParam, TargetLastParam);
		if (Projector.NbPoints() > 0 && Projector.LowerDistance() <= Tolerance)
		{
			double ParamOnTargetCurve = Projector.LowerDistanceParameter();
			// 验证参数是否在有效范围内（不是端点，避免重复检测）
			if (ParamOnTargetCurve > TargetFirstParam + Tolerance && ParamOnTargetCurve < TargetLastParam - Tolerance)
			{
				FCurveIntersectionInfo IntersectionInfo;
				IntersectionInfo.Position = FVector(TestPoint.X(), TestPoint.Y(), TestPoint.Z());
				IntersectionInfo.Curve1Index = TestCurveIndex;
				IntersectionInfo.Curve2Index = TargetCurveIndex;
				
				// 根据测试点属于哪条曲线，设置正确的参数顺序
				if (TestCurveIndex == Curve1Index)
				{
					IntersectionInfo.Parameter1 = TestPointParam;
					IntersectionInfo.Parameter2 = ParamOnTargetCurve;
				}
				else
				{
					IntersectionInfo.Parameter1 = ParamOnTargetCurve;
					IntersectionInfo.Parameter2 = TestPointParam;
				}
				
				IntersectionInfo.Tolerance = Tolerance;
				
				OutIntersections.Add(IntersectionInfo);
				
				UE_LOG(LogTemp, VeryVerbose, TEXT("发现端点相交: %s, 位置(%f,%f,%f), 参数1=%f, 参数2=%f"), 
					*LogDescription, TestPoint.X(), TestPoint.Y(), TestPoint.Z(), 
					IntersectionInfo.Parameter1, IntersectionInfo.Parameter2);
				
				return true;
			}
		}
		return false;
	};
	
	// 获取所有端点
	gp_Pnt Edge1StartPoint = Curve1->Value(Edge1FirstParam);
	gp_Pnt Edge1EndPoint = Curve1->Value(Edge1LastParam);
	gp_Pnt Edge2StartPoint = Curve2->Value(Edge2FirstParam);
	gp_Pnt Edge2EndPoint = Curve2->Value(Edge2LastParam);
	
	// 检查Edge1的端点是否在Edge2上
	if(CheckPointOnCurve(Edge1StartPoint, Edge1FirstParam, Curve2, Edge2FirstParam, Edge2LastParam, 
					  Curve1Index, Curve2Index, TEXT("Edge1起点在Edge2上")))
	{
		return true;
	}
	
	if(CheckPointOnCurve(Edge1EndPoint, Edge1LastParam, Curve2, Edge2FirstParam, Edge2LastParam, 
					  Curve1Index, Curve2Index, TEXT("Edge1终点在Edge2上")))
	{
		return true;
	}
	
	// 检查Edge2的端点是否在Edge1上
	if(CheckPointOnCurve(Edge2StartPoint, Edge2FirstParam, Curve1, Edge1FirstParam, Edge1LastParam, 
					  Curve1Index, Curve2Index, TEXT("Edge2起点在Edge1上")))
	{
		return true;
	}
	
	if(CheckPointOnCurve(Edge2EndPoint, Edge2LastParam, Curve1, Edge1FirstParam, Edge1LastParam, 
					  Curve1Index, Curve2Index, TEXT("Edge2终点在Edge1上")))
	{
		return true;
	}
	
	return OutIntersections.Num() > 0;
}

bool FGeomUtils::SplitCurvesAtIntersections(
	const TArray<UGeomCurve*>& InCurves,
	const TArray<FCurveIntersectionInfo>& InIntersections,
	TArray<UGeomCurve*>& OutSplitCurves)
{
	UE_LOG(LogTemp, Log, TEXT("FGeomUtils::SplitCurvesAtIntersections - 开始分割曲线，输入 %d 条曲线，%d 个交点"), 
		InCurves.Num(), InIntersections.Num());
	
	OutSplitCurves.Empty();
	
	if (InCurves.Num() == 0)
	{
		return false;
	}
	
	// 如果没有交点，直接返回原始曲线
	if (InIntersections.Num() == 0)
	{
		OutSplitCurves = InCurves;
		return true;
	}
	
	// 为每条曲线收集其上的所有交点
	TMap<int32, TArray<float>> CurveIntersectionParams;
	
	for (const FCurveIntersectionInfo& Intersection : InIntersections)
	{
		// 添加第一条曲线的参数
		TArray<float>& Params1 = CurveIntersectionParams.FindOrAdd(Intersection.Curve1Index);
		Params1.AddUnique(Intersection.Parameter1);
		
		// 添加第二条曲线的参数
		TArray<float>& Params2 = CurveIntersectionParams.FindOrAdd(Intersection.Curve2Index);
		Params2.AddUnique(Intersection.Parameter2);
	}
	
	// 对每条曲线进行分割
	for (int32 CurveIndex = 0; CurveIndex < InCurves.Num(); ++CurveIndex)
	{
		UGeomCurve* OriginalCurve = InCurves[CurveIndex];
		if (!OriginalCurve)
		{
			continue;
		}
		
		// 检查该曲线是否有交点
		TArray<float>* IntersectionParams = CurveIntersectionParams.Find(CurveIndex);
		if (!IntersectionParams || IntersectionParams->Num() == 0)
		{
			// 没有交点，直接添加原始曲线
			OutSplitCurves.Add(OriginalCurve);
			continue;
		}
		
		// 对参数进行排序
		IntersectionParams->Sort();
		
		// 获取曲线的几何信息
		TopoDS_Shape CurveShape = OriginalCurve->ToShape();
		if (CurveShape.ShapeType() != TopAbs_EDGE)
		{
			OutSplitCurves.Add(OriginalCurve);
			continue;
		}
		
		TopoDS_Edge OriginalEdge = TopoDS::Edge(CurveShape);
		double FirstParam, LastParam;
		Handle(Geom_Curve) GeomCurve = BRep_Tool::Curve(OriginalEdge, FirstParam, LastParam);
		
		if (GeomCurve.IsNull())
		{
			OutSplitCurves.Add(OriginalCurve);
			continue;
		}
		
		// 在交点处分割曲线
		float PreviousParam = FirstParam;
		
		for (float IntersectionParam : *IntersectionParams)
		{
			// 确保参数在有效范围内
			if (IntersectionParam <= FirstParam || IntersectionParam >= LastParam)
			{
				continue;
			}
			
			// 创建从上一个参数到当前交点的曲线段
			if (IntersectionParam > PreviousParam + FPrecision::Confusion())
			{
				try
				{
					Handle(Geom_TrimmedCurve) TrimmedCurve = new Geom_TrimmedCurve(GeomCurve, PreviousParam, IntersectionParam);
					
					// 创建边
					TopoDS_Edge NewEdge = BRepBuilderAPI_MakeEdge(TrimmedCurve);
					
					// 转换为UGeomCurve
					UGeomCurve* NewGeomCurve = GetGeomCurveFromEdge(NewEdge);
					if (NewGeomCurve)
					{
						OutSplitCurves.Add(NewGeomCurve);
					}
				}
				catch (...)
				{
					UE_LOG(LogTemp, Warning, TEXT("曲线分割失败：曲线 %d, 参数范围 [%f, %f]"), 
						CurveIndex, PreviousParam, IntersectionParam);
				}
			}
			
			PreviousParam = IntersectionParam;
		}
		
		// 创建从最后一个交点到曲线末端的线段
		if (LastParam > PreviousParam + FPrecision::Confusion())
		{
			try
			{
				Handle(Geom_TrimmedCurve) TrimmedCurve = new Geom_TrimmedCurve(GeomCurve, PreviousParam, LastParam);
				
				// 创建边
				TopoDS_Edge NewEdge = BRepBuilderAPI_MakeEdge(TrimmedCurve);
				
				// 转换为UGeomCurve
				UGeomCurve* NewGeomCurve = GetGeomCurveFromEdge(NewEdge);
				if (NewGeomCurve)
				{
					OutSplitCurves.Add(NewGeomCurve);
				}
			}
			catch (...)
			{
				UE_LOG(LogTemp, Warning, TEXT("曲线分割失败：曲线 %d, 参数范围 [%f, %f]"), 
					CurveIndex, PreviousParam, LastParam);
			}
		}
	}
	
	UE_LOG(LogTemp, Log, TEXT("FGeomUtils::SplitCurvesAtIntersections - 完成，生成 %d 条分割曲线"), OutSplitCurves.Num());
	return OutSplitCurves.Num() > 0;
}

bool FGeomUtils::IdentifyClosedRegionsFromSplitCurves(
	const TArray<UGeomCurve*>& InSplitCurves,
	TArray<FClosedRegion>& OutClosedRegions,
	double Tolerance)
{
	UE_LOG(LogTemp, Log, TEXT("FGeomUtils::IdentifyClosedRegionsFromSplitCurves - 开始识别封闭区域，输入 %d 条曲线"), 
		InSplitCurves.Num());
	
	OutClosedRegions.Empty();
	
	if (InSplitCurves.Num() < 3)
	{
		UE_LOG(LogTemp, Warning, TEXT("曲线数量不足3条，无法形成封闭区域"));
		return false;
	}
	
	// 使用现有的GetClosedCurvesListFromUnorderCurves方法识别封闭曲线组
	TArray<TArray<UGeomCurve*>> ClosedCurveGroups = GetClosedCurvesListFromUnorderCurves(InSplitCurves);
	
	UE_LOG(LogTemp, Log, TEXT("识别到 %d 个封闭曲线组"), ClosedCurveGroups.Num());
	
	// 处理每个封闭曲线组
	for (const TArray<UGeomCurve*>& CurveGroup : ClosedCurveGroups)
	{
		if (CurveGroup.Num() < 3)
		{
			continue;
		}
		
		// 验证曲线组是否真正封闭
		TopoDS_Wire Wire = MakeWireFromCurves(CurveGroup);
		if (Wire.IsNull() || !IsShapeClosed(Wire))
		{
			UE_LOG(LogTemp, VeryVerbose, TEXT("曲线组未形成封闭线框，跳过"));
			continue;
		}
		
		// 创建封闭区域对象
		FClosedRegion ClosedRegion;
		ClosedRegion.BoundaryCurves = CurveGroup;
		
		// 计算包围盒
		ClosedRegion.BoundingBox = GetBounds(Wire);
		
		// 计算面积
		TopoDS_Face Face = MakeFaceFromClosedWire(Wire);
		if (!Face.IsNull())
		{
			ClosedRegion.Area = CalculateShapeArea(Face);
		}
		else
		{
			ClosedRegion.Area = 0.0f;
		}
		
		// 计算中心点
		if (ClosedRegion.BoundingBox.IsValid)
		{
			ClosedRegion.CenterPoint = ClosedRegion.BoundingBox.GetCenter();
		}
		else
		{
			ClosedRegion.CenterPoint = FVector::ZeroVector;
		}
		
		// 判断是否为顺时针方向（假设在XY平面上）
		TArray<FVector> Points;
		for (UGeomCurve* Curve : CurveGroup)
		{
			if (Curve)
			{
				Handle(Geom_Curve) CurveGeom = Handle(Geom_Curve)::DownCast(Curve->GetHandle());
				if (CurveGeom.IsNull())
				{
					continue;
				}
				Points.Add(Curve->PointAtParameter(Curve->GetFirstParameter()));
			}
		}
		
		if (Points.Num() >= 3)
		{
			ClosedRegion.bIsClockwise = FBKMath::IsClockwise(Points);
		}
		else
		{
			ClosedRegion.bIsClockwise = false;
		}
		
		// 默认为外部轮廓（嵌套分析将在后续处理）
		ClosedRegion.bIsOuterBoundary = true;
		
		// 验证区域的有效性
		if (ClosedRegion.Area > 1.0f && ClosedRegion.BoundingBox.IsValid) // 最小面积1平方厘米
		{
			OutClosedRegions.Add(ClosedRegion);
			
			UE_LOG(LogTemp, VeryVerbose, TEXT("识别到有效封闭区域：面积=%.2f, 中心点=(%f,%f,%f)"), 
				ClosedRegion.Area, 
				ClosedRegion.CenterPoint.X, ClosedRegion.CenterPoint.Y, ClosedRegion.CenterPoint.Z);
		}
	}
	
	UE_LOG(LogTemp, Log, TEXT("FGeomUtils::IdentifyClosedRegionsFromSplitCurves - 完成，识别到 %d 个有效封闭区域"), 
		OutClosedRegions.Num());
	
	return OutClosedRegions.Num() > 0;
}

bool FGeomUtils::AnalyzeRegionNesting(
	const TArray<FClosedRegion>& InRegions,
	TMap<int32, TArray<int32>>& OutNestingRelations)
{
	UE_LOG(LogTemp, Log, TEXT("FGeomUtils::AnalyzeRegionNesting - 开始分析 %d 个区域的嵌套关系"), InRegions.Num());
	
	OutNestingRelations.Empty();
	
	if (InRegions.Num() < 2)
	{
		UE_LOG(LogTemp, Log, TEXT("区域数量不足2个，无需分析嵌套关系"));
		return true;
	}
	
	// 遍历所有区域对，检查嵌套关系
	for (int32 i = 0; i < InRegions.Num(); ++i)
	{
		for (int32 j = 0; j < InRegions.Num(); ++j)
		{
			if (i == j)
			{
				continue;
			}
			
			const FClosedRegion& InnerRegion = InRegions[i];
			const FClosedRegion& OuterRegion = InRegions[j];
			
			// 检查区域i是否在区域j内部
			if (IsPointInClosedRegion(InnerRegion.CenterPoint, OuterRegion))
			{
				// 进一步验证：检查内部区域的所有边界点是否都在外部区域内
				bool bAllPointsInside = true;
				for (UGeomCurve* Curve : InnerRegion.BoundaryCurves)
				{
					Handle(Geom_Curve) CurveGeom = Handle(Geom_Curve)::DownCast(Curve->GetHandle());
					if (CurveGeom.IsNull())
					{
						continue;
					}
					//FGeomUtils::GetShapeCurves(Curve->ToShape(), TArray<UGeomCurve*>());
					if (!IsPointInClosedRegion(Curve->PointAtParameter(Curve->GetFirstParameter()), OuterRegion) ||
						!IsPointInClosedRegion(Curve->PointAtParameter(Curve->GetLastParameter()), OuterRegion))
					{
						bAllPointsInside = false;
						break;
					}
				}
				
				if (bAllPointsInside)
				{
					// 区域i在区域j内部
					TArray<int32>& NestedRegions = OutNestingRelations.FindOrAdd(j);
					NestedRegions.AddUnique(i);
					
					UE_LOG(LogTemp, VeryVerbose, TEXT("发现嵌套关系：区域 %d 包含区域 %d"), j, i);
				}
			}
		}
	}
	
	UE_LOG(LogTemp, Log, TEXT("FGeomUtils::AnalyzeRegionNesting - 完成，发现 %d 个嵌套关系"), OutNestingRelations.Num());
	return true;
}

bool FGeomUtils::ProjectGeometryToSurface(
	const TArray<UGeometryBase*>& InGeometry,
	const FPlane& InSurfacePlane,
	TArray<UGeometryBase*>& OutProjectedGeometry)
{
	UE_LOG(LogTemp, Log, TEXT("FGeomUtils::ProjectGeometryToSurface - 开始投影 %d 个几何对象到表面平面"), 
		InGeometry.Num());
	
	OutProjectedGeometry.Empty();
	
	if (InGeometry.Num() == 0)
	{
		return true;
	}
	
	// 创建OCCT投影平面
	FVector PlaneOrigin = InSurfacePlane.GetOrigin();
	FVector PlaneNormal = InSurfacePlane.GetNormal();
	
	gp_Pnt Origin(PlaneOrigin.X, PlaneOrigin.Y, PlaneOrigin.Z);
	gp_Dir Normal(PlaneNormal.X, PlaneNormal.Y, PlaneNormal.Z);
	gp_Pln ProjectionPlane(Origin, Normal);
	
	int32 SuccessCount = 0;
	
	// 投影每个几何对象
	for (UGeometryBase* Geometry : InGeometry)
	{
		if (!Geometry)
		{
			continue;
		}
		
		TopoDS_Shape OriginalShape = Geometry->ToShape();
		if (OriginalShape.IsNull())
		{
			continue;
		}
		
		try
		{
			// 根据几何类型进行投影
			if (OriginalShape.ShapeType() == TopAbs_EDGE)
			{
				TopoDS_Edge OriginalEdge = TopoDS::Edge(OriginalShape);
				
				// 获取边的端点
				FVector StartPoint, EndPoint;
				GetEdgeStartAndEnd(OriginalEdge, StartPoint, EndPoint);
				
				// 投影端点到平面
				FVector ProjectedStart = FVector::PointPlaneProject(StartPoint, InSurfacePlane);
				FVector ProjectedEnd = FVector::PointPlaneProject(EndPoint, InSurfacePlane);
				
				// 检查投影是否有效（点不应该重合）
				if (!ProjectedStart.Equals(ProjectedEnd, FPrecision::Confusion()))
				{
					// 创建投影后的线段
					UGeomLineSegment* ProjectedLine = MakeGeomLineSegment(ProjectedStart, ProjectedEnd);
					if (ProjectedLine)
					{
						OutProjectedGeometry.Add(ProjectedLine);
						SuccessCount++;
					}
				}
			}
			else if (OriginalShape.ShapeType() == TopAbs_VERTEX)
			{
				TopoDS_Vertex OriginalVertex = TopoDS::Vertex(OriginalShape);
				gp_Pnt OriginalPoint = BRep_Tool::Pnt(OriginalVertex);
				FVector Point(OriginalPoint.X(), OriginalPoint.Y(), OriginalPoint.Z());
				
				// 投影点到平面
				FVector ProjectedPoint = FVector::PointPlaneProject(Point, InSurfacePlane);
				
				// 创建投影后的点
				UGeomPoint* ProjectedGeomPoint = NewObject<UGeomPoint>();
				ProjectedGeomPoint->SetPoint(ProjectedPoint);
				OutProjectedGeometry.Add(ProjectedGeomPoint);
				SuccessCount++;
			}
			else if (OriginalShape.ShapeType() == TopAbs_FACE)
			{
				// 对于面，投影其边界曲线
				TArray<UGeomCurve*> BoundaryCurves;
				if (GetShapeCurves(OriginalShape, BoundaryCurves))
				{
					TArray<UGeometryBase*> CurveGeometries;
					for (UGeomCurve* Curve : BoundaryCurves)
					{
						CurveGeometries.Add(Curve);
					}
					
					TArray<UGeometryBase*> ProjectedCurves;
					if (ProjectGeometryToSurface(CurveGeometries, InSurfacePlane, ProjectedCurves))
					{
						OutProjectedGeometry.Append(ProjectedCurves);
						SuccessCount += ProjectedCurves.Num();
					}
				}
			}
		}
		catch (...)
		{
			UE_LOG(LogTemp, Warning, TEXT("几何投影失败：几何对象类型 %d"), OriginalShape.ShapeType());
		}
	}
	
	UE_LOG(LogTemp, Log, TEXT("FGeomUtils::ProjectGeometryToSurface - 完成，成功投影 %d/%d 个几何对象"), 
		SuccessCount, InGeometry.Num());
	
	return SuccessCount > 0;
}

bool FGeomUtils::IsPointInClosedRegion(
	const FVector& InPoint,
	const FClosedRegion& InRegion,
	double Tolerance)
{
	// 检查区域的有效性
	if (InRegion.BoundaryCurves.Num() < 3)
	{
		return false;
	}
	
	// 首先进行包围盒检查（快速排除）
	if (InRegion.BoundingBox.IsValid)
	{
		FVector ExpandedMin = InRegion.BoundingBox.Min - FVector(Tolerance);
		FVector ExpandedMax = InRegion.BoundingBox.Max + FVector(Tolerance);
		
		if (InPoint.X < ExpandedMin.X || InPoint.X > ExpandedMax.X ||
			InPoint.Y < ExpandedMin.Y || InPoint.Y > ExpandedMax.Y ||
			InPoint.Z < ExpandedMin.Z || InPoint.Z > ExpandedMax.Z)
		{
			return false;
		}
	}
	
	// 将封闭区域的边界曲线转换为2D多边形点
	TArray<FVector2D> PolygonPoints;
	for (UGeomCurve* Curve : InRegion.BoundaryCurves)
	{
		if (Curve)
		{
			Handle(Geom_Curve) CurveGeom = Handle(Geom_Curve)::DownCast(Curve->GetHandle());
			if (CurveGeom.IsNull())
			{
				continue;
			}
			FVector StartPoint = Curve->PointAtParameter(Curve->GetFirstParameter());
			PolygonPoints.Add(FVector2D(StartPoint.X, StartPoint.Y));
		}
	}
	
	// 移除重复的相邻点
	for (int32 i = PolygonPoints.Num() - 1; i > 0; --i)
	{
		if (PolygonPoints[i].Equals(PolygonPoints[i-1], Tolerance))
		{
			PolygonPoints.RemoveAt(i);
		}
	}
	
	// 检查首尾点是否重复
	if (PolygonPoints.Num() > 0 && PolygonPoints[0].Equals(PolygonPoints.Last(), Tolerance))
	{
		PolygonPoints.RemoveAt(PolygonPoints.Num() - 1);
	}
	
	if (PolygonPoints.Num() < 3)
	{
		return false;
	}
	
	// 使用现有的IsPointInOrOnPolygon2D方法
	FVector2D TestPoint2D(InPoint.X, InPoint.Y);
	return IsPointInOrOnPolygon2D(TestPoint2D, PolygonPoints, Tolerance);
}

bool FGeomUtils::SplitLineIfIntersect(const UGeomCurve* InCurve1, const UGeomCurve* InCurve2, TArray<UGeomCurve*>& OutLines1, TArray<UGeomCurve*>& OutLines2)
{
	if (!InCurve1 || !InCurve2 || !InCurve1->IsA<UGeomLineSegment>() || !InCurve2->IsA<UGeomLineSegment>())
		return false;

	FVector Start1, End1;
	FVector Start2, End2;
	if (GetCurveStartAndEndPoint(InCurve1, Start1, End1) && GetCurveStartAndEndPoint(InCurve2, Start2, End2))
	{
		FVector InterPoint;
		if (FBKMath::SegmentIntersection2DExcludeEndPointConnected(Start1, End1, Start2, End2, InterPoint, FPrecision::Confusion()))
		{
			if (!Start1.Equals(InterPoint, FPrecision::Confusion()))
				OutLines1.Add(FGeomUtils::MakeGeomLineSegment(Start1, InterPoint));

			if (!End1.Equals(InterPoint, FPrecision::Confusion()))
				OutLines1.Add(FGeomUtils::MakeGeomLineSegment(InterPoint, End1));

			if (!Start2.Equals(InterPoint, FPrecision::Confusion()))
				OutLines2.Add(FGeomUtils::MakeGeomLineSegment(Start2, InterPoint));

			if (!End2.Equals(InterPoint, FPrecision::Confusion()))
				OutLines2.Add(FGeomUtils::MakeGeomLineSegment(InterPoint, End2));

			return true;
		}
	}

	return false;
}

void FGeomUtils::SplitLinesIfIntersect(TArray<UGeomCurve*>& InOutLines1, TArray<UGeomCurve*>& InOutLines2)
{
	for (int i = 0; i < InOutLines1.Num(); ++i)
	{
		for (int j = 0; j < InOutLines2.Num(); ++j)
		{
			TArray<UGeomCurve*> OutSplitLines1, OutSplitLines2;
			if (SplitLineIfIntersect(InOutLines1[i], InOutLines2[j], OutSplitLines1, OutSplitLines2))
			{
				InOutLines1.Append(OutSplitLines1);
				InOutLines2.Append(OutSplitLines2);

				// 移除被分割的
				InOutLines1.RemoveAt(i);
				InOutLines2.RemoveAt(j);

				--i;
				break;
			}
		}
	}
}

// by AI
bool FGeomUtils::AreShapesAdjacent(const TopoDS_Shape& Shape1, const TopoDS_Shape& Shape2, double Tolerance)
{
	// 遍历第一个形状的所有边
	TopExp_Explorer explorer1(Shape1, TopAbs_EDGE);
	for (; explorer1.More(); explorer1.Next()) 
	{
		TopoDS_Edge edge1 = TopoDS::Edge(explorer1.Current());

		// 遍历第二个形状的所有边
		TopExp_Explorer explorer2(Shape2, TopAbs_EDGE);
		for (; explorer2.More(); explorer2.Next()) 
		{
			TopoDS_Edge edge2 = TopoDS::Edge(explorer2.Current());

			// 计算两边的几何距离
			BRepExtrema_DistShapeShape distTool(edge1, edge2);
			distTool.Perform();

			if (distTool.Value() < Tolerance) 
				return true; // 存在相邻边
		}
	}

	return false;
}

bool FGeomUtils::AreShapesParallel(const TopoDS_Shape& Shape1, const TopoDS_Shape& Shape2, double Tolerance)
{
	// 检查输入是否为空或无效
	if (Shape1.IsNull() || Shape2.IsNull())
	{
		return false;
	}

	// 检查是否都是边
	if (Shape1.ShapeType() != TopAbs_EDGE || Shape2.ShapeType() != TopAbs_EDGE)
	{
		return false;
	}

	try
	{
		// 转换为边
		TopoDS_Edge Edge1 = TopoDS::Edge(Shape1);
		TopoDS_Edge Edge2 = TopoDS::Edge(Shape2);

		// 创建曲线适配器来获取几何信息
		BRepAdaptor_Curve Adaptor1(Edge1);
		BRepAdaptor_Curve Adaptor2(Edge2);

		// 获取曲线类型
		GeomAbs_CurveType Type1 = Adaptor1.GetType();
		GeomAbs_CurveType Type2 = Adaptor2.GetType();

		// 如果都是直线，检查方向向量平行
		if (Type1 == GeomAbs_Line && Type2 == GeomAbs_Line)
		{
			gp_Dir Dir1 = Adaptor1.Line().Direction();
			gp_Dir Dir2 = Adaptor2.Line().Direction();

			// 检查方向向量是否平行（考虑反向平行）
			double DotProduct = Dir1.Dot(Dir2);
			return FMath::Abs(FMath::Abs(DotProduct) - 1.0) <= Tolerance;
		}
		// 如果都是圆弧，检查轴线是否平行且半径相等
		if (Type1 == GeomAbs_Circle && Type2 == GeomAbs_Circle)
		{
			gp_Circ Circle1 = Adaptor1.Circle();
			gp_Circ Circle2 = Adaptor2.Circle();

			// 检查轴线方向是否平行
			gp_Dir Axis1 = Circle1.Axis().Direction();
			gp_Dir Axis2 = Circle2.Axis().Direction();
			double AxisDot = Axis1.Dot(Axis2);

			// 检查半径是否相等
			double Radius1 = Circle1.Radius();
			double Radius2 = Circle2.Radius();

			return (FMath::Abs(FMath::Abs(AxisDot) - 1.0) <= Tolerance) &&
				(FMath::Abs(Radius1 - Radius2) <= Tolerance);
		}

		// 对于其他类型的曲线，通过采样点检查切线方向
		if (Type1 != GeomAbs_Line || Type2 != GeomAbs_Line)
		{
			// 在曲线的中点处计算切线方向
			double FirstParam1 = Adaptor1.FirstParameter();
			double LastParam1 = Adaptor1.LastParameter();
			double MidParam1 = (FirstParam1 + LastParam1) * 0.5;

			double FirstParam2 = Adaptor2.FirstParameter();
			double LastParam2 = Adaptor2.LastParameter();
			double MidParam2 = (FirstParam2 + LastParam2) * 0.5;

			gp_Pnt Point1, Point2;
			gp_Vec Tangent1, Tangent2;

			// 计算切线向量
			Adaptor1.D1(MidParam1, Point1, Tangent1);
			Adaptor2.D1(MidParam2, Point2, Tangent2);

			// 标准化切线向量
			if (Tangent1.Magnitude() > Tolerance && Tangent2.Magnitude() > Tolerance)
			{
				Tangent1.Normalize();
				Tangent2.Normalize();

				// 检查切线方向是否平行
				double TangentDot = Tangent1.Dot(Tangent2);
				return FMath::Abs(FMath::Abs(TangentDot) - 1.0) <= Tolerance;
			}
		}
	}
	catch (const Standard_Failure&)
	{
		// OCCT异常处理
		return false;
	}
	return false;
}
bool FGeomUtils::AreSegmentsOverlapping(const TopoDS_Shape& Shape1, const TopoDS_Shape& Shape2, 
	double tolerance)
{
	// 检查输入是否为空或无效
	if (Shape1.IsNull() || Shape2.IsNull())
	{
		return false;
	}

	// 检查是否都是边
	if (Shape1.ShapeType() != TopAbs_EDGE || Shape2.ShapeType() != TopAbs_EDGE)
	{
		return false;
	}

	TopoDS_Edge edge1 = TopoDS::Edge(Shape1);
	TopoDS_Edge edge2 = TopoDS::Edge(Shape2);

	// 获取边的几何信息
	Standard_Real first1, last1, first2, last2;
	Handle(Geom_Curve) curve1 = BRep_Tool::Curve(edge1, first1, last1);
	Handle(Geom_Curve) curve2 = BRep_Tool::Curve(edge2, first2, last2);

	// 检查是否都是直线
	Handle(Geom_Line) line1 = Handle(Geom_Line)::DownCast(curve1);
	Handle(Geom_Line) line2 = Handle(Geom_Line)::DownCast(curve2);

	if (line1.IsNull() || line2.IsNull()) {
		return false; // 不是直线段
	}

	// 使用BRepExtrema_DistShapeShape计算线段之间的最小距离
	// 这比gp_Lin::Distance()更准确，因为它计算的是线段而非无限直线的距离
	Standard_Real distance = FGeomUtils::ComputeDistance(edge1, edge2);
	if (distance > tolerance) {
		return false; // 线段距离过大，不重叠
	}

	// 获取两条直线的几何信息用于后续平行性检查
	gp_Lin gp_line1 = line1->Lin();
	gp_Lin gp_line2 = line2->Lin();
	
	// 检查方向是否一致或相反
	gp_Dir dir1 = gp_line1.Direction();
	gp_Dir dir2 = gp_line2.Direction();
	Standard_Real dotProduct = dir1.Dot(dir2);

	if (Abs(Abs(dotProduct) - 1.0) > tolerance) {
		return false; // 方向不平行
	}

	// 将线段投影到同一条直线上，检查参数范围是否重叠
	gp_Pnt p1_start = curve1->Value(first1);
	gp_Pnt p1_end = curve1->Value(last1);
	gp_Pnt p2_start = curve2->Value(first2);
	gp_Pnt p2_end = curve2->Value(last2);

	// 计算在第一条直线上的投影参数
	Standard_Real t1_start = ElCLib::Parameter(gp_line1, p1_start);
	Standard_Real t1_end = ElCLib::Parameter(gp_line1, p1_end);
	Standard_Real t2_start = ElCLib::Parameter(gp_line1, p2_start);
	Standard_Real t2_end = ElCLib::Parameter(gp_line1, p2_end);

	// 确保参数顺序正确
	if (t1_start > t1_end) std::swap(t1_start, t1_end);
	if (t2_start > t2_end) std::swap(t2_start, t2_end);

	// 检查参数区间是否重叠
	return !(t1_end - tolerance < t2_start  || t2_end < t1_start + tolerance);
} 

TArray<UGeometryBase*> FGeomUtils::ExcludeGeometryOverlappingWithBoundaries(const TArray<UGeometryBase*>& InGeometryObjects, const TArray<UGeomCurve*>& InBoundaryCurves)
{
	// 排除与边界曲线重叠的几何对象
	TArray<UGeometryBase*> NonOverlappingGeometry;
	
	for (UGeometryBase* GeometryObject : InGeometryObjects)
	{
		bool bIsOverlapping = false;
		UGeomCurve* GeometryCurve = Cast<UGeomCurve>(GeometryObject);
		
		if (GeometryCurve)
		{
			// 检查当前曲线是否与边界曲线中的任何曲线有重合
			for (UGeomCurve* BoundaryCurve : InBoundaryCurves)
			{
				if (!BoundaryCurve)
					continue;
					
				// 获取两个曲线的Shape进行几何比较
				TopoDS_Shape GeometryShape = GeometryCurve->ToShape();
				TopoDS_Shape BoundaryShape = BoundaryCurve->ToShape();
				
				if (!GeometryShape.IsNull() && !BoundaryShape.IsNull())
				{
					// 使用AreSegmentsOverlapping检查两个曲线是否重合
					if (FGeomUtils::AreSegmentsOverlapping(GeometryShape, BoundaryShape))
					{
						bIsOverlapping = true;
						break;
					}
				}
			}
		}
		
		// 如果没有重合，则添加到过滤后的列表中
		if (!bIsOverlapping)
		{
			NonOverlappingGeometry.Add(GeometryObject);
		}
	}
	
	return NonOverlappingGeometry;
}

// AI给的投影算法都不行
TopoDS_Shape FGeomUtils::ProjectToXYPlane(const TopoDS_Shape& InShape)
{
	TArray<TopoDS_Edge> ExtractedFaceEdges;
	FGeomUtils::GetShapeEdges(InShape, ExtractedFaceEdges);
	TArray<UGeomCurve*> OutCurves = GetGeomCurveListFromEdges(ExtractedFaceEdges);

	for (UGeomCurve*& It : OutCurves)
	{
		if (It)
		{
			FVector Start, End;
			if (GetCurveStartAndEndPoint(It, Start, End))
			{
				It = Cast<UGeomCurve>(It->TransformCurves(FTransform(FVector(0, 0, -Start.Z)), true));
			}
		}
	}

	TopoDS_Face NewShape;
	CreateFaceFromCurves(OutCurves, NewShape);
	return NewShape;
}

TArray<TopoDS_Edge> FGeomUtils::ComputeIntersectionLines(const TopoDS_Shape& ShapeA, const TopoDS_Shape& ShapeB, double Tolerance)
{
	TArray<TopoDS_Edge> ResultEdges;

	// 创建截面计算器
	BRepAlgoAPI_Section SectionMaker;
	SectionMaker.Init1(ShapeA);
	SectionMaker.Init2(ShapeB);
	SectionMaker.Approximation(true); // 启用近似处理
	SectionMaker.SetFuzzyValue(Tolerance); // 关键精度控制
	SectionMaker.Build();

	if (!SectionMaker.IsDone()) return ResultEdges;

	// 提取所有交线边
	TopExp_Explorer EdgeExplorer(SectionMaker.Shape(), TopAbs_EDGE);
	for (; EdgeExplorer.More(); EdgeExplorer.Next()) {
		TopoDS_Edge Edge = TopoDS::Edge(EdgeExplorer.Current());
		if (!Edge.IsNull()) {
			ResultEdges.Add(Edge);
		}
	}

	return ResultEdges;
}